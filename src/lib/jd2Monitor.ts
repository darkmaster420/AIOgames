import connectDB from './db';
import { AutoDownloadJob } from './models';
import { isJd2StatusConfigured, queryJd2Downloads, removeJd2Links, type Jd2Link, type Jd2Package } from './jd2Client';
import { performJd2Dispatch, type AutoDownloadLink } from './jd2AutoDownloads';
import { getLocalProfile } from './localProfile';
import { runLibraryScan } from './libraryScanner';
import logger from '../utils/logger';

type MonitoredJob = {
  _id: unknown;
  gameTitle: string;
  version?: string;
  gameLink: string;
  packageName: string;
  currentHost?: string;
  attemptedHosts?: string[];
  hierarchy?: string[];
  downloadLinks?: Array<AutoDownloadLink & { hostKey?: string }>;
  jdPackageId?: string;
  jdLinkIds?: string[];
  progressBytes?: number;
  lastProgressAt?: Date;
  sentAt?: Date;
  retryCount?: number;
};

type DownloadState = 'waiting' | 'downloading' | 'stalled' | 'captcha' | 'offline' | 'error' | 'completed';

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envMinutes(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function classifyDownload(pkg: Jd2Package, links: Jd2Link[], stalled: boolean): DownloadState {
  const statusText = [pkg.status, ...links.map(link => link.status)].join(' ').toLowerCase();
  const loadedBytes = Math.max(Number(pkg.bytesLoaded || 0), links.reduce((sum, link) => sum + Number(link.bytesLoaded || 0), 0));
  const totalBytes = Math.max(Number(pkg.bytesTotal || 0), links.reduce((sum, link) => sum + Number(link.bytesTotal || 0), 0));
  if (
    pkg.finished
    || (links.length > 0 && links.every(link => link.finished))
    || (totalBytes > 0 && loadedBytes >= totalBytes)
    || /\b(finished|complete|completed|downloaded)\b/.test(statusText)
  ) return 'completed';
  if (/captcha|recaptcha|hcaptcha|cutcaptcha/.test(statusText)) return 'captcha';
  if (/offline|file not found|not found|does not exist|404/.test(statusText)) return 'offline';
  if (/too many retries|plugin defect|invalid destination|disk full|no account|account is missing|fatal|failed|error/.test(statusText)) return 'error';
  if (pkg.running || pkg.speed > 0 || links.some(link => link.running || link.speed > 0)) return 'downloading';
  if (stalled) return 'stalled';
  return 'waiting';
}

function packageLinks(allLinks: Jd2Link[], packageId: string): Jd2Link[] {
  return allLinks.filter(link => String(link.packageUUID) === packageId);
}

async function dispatchHost(job: MonitoredJob, host: string, reason: string): Promise<boolean> {
  const links = (job.downloadLinks || []).filter(link => link.hostKey === host);
  if (!links.length) return false;

  const result = await performJd2Dispatch({
    gameTitle: job.gameTitle,
    version: job.version,
    gameLink: job.gameLink,
    downloadLinks: links,
    ignoreHostPriority: true,
  });

  await AutoDownloadJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: result.ok ? 'retrying' : 'error',
        currentHost: host,
        selectedHosts: result.selectedHosts,
        message: result.ok ? `${reason} Trying ${host}.` : result.message,
        sentAt: new Date(),
        lastStatusAt: new Date(),
        lastProgressAt: new Date(),
        jdPackageId: '',
        jdLinkIds: [],
        progressBytes: 0,
        speedBytesPerSecond: 0,
      },
      $addToSet: { attemptedHosts: host },
      $inc: { retryCount: 1 },
    },
  );
  return result.ok;
}

async function failOver(job: MonitoredJob, links: Jd2Link[], reason: string): Promise<void> {
  const attempted = new Set([...(job.attemptedHosts || []), job.currentHost || ''].filter(Boolean));
  const nextHost = (job.hierarchy || [])
    .find(host => !attempted.has(host) && (job.downloadLinks || []).some(link => link.hostKey === host));

  if (!nextHost) {
    await AutoDownloadJob.updateOne(
      { _id: job._id },
      { $set: { status: 'failed', message: `${reason} No fallback hosts remain.`, lastStatusAt: new Date() } },
    );
    return;
  }

  const linkIds = links.map(link => String(link.uuid)).filter(Boolean);
  try {
    await removeJd2Links(linkIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await AutoDownloadJob.updateOne(
      { _id: job._id },
      { $set: { status: 'error', message: `${reason} Could not remove the failed JD2 links: ${message}`, lastStatusAt: new Date() } },
    );
    return;
  }

  await dispatchHost(job, nextHost, reason);
}

export async function monitorJd2Downloads(): Promise<void> {
  if (!isJd2StatusConfigured()) return;
  await connectDB();

  const jobs = await AutoDownloadJob.find({
    downloader: { $in: ['jd2-api', 'jd2-folderwatch', 'mixed'] },
    status: { $in: ['queued', 'sent', 'waiting', 'downloading', 'stalled', 'captcha', 'offline', 'error', 'retrying'] },
  }).lean<MonitoredJob[]>();
  if (!jobs.length) return;

  const { packages, links } = await queryJd2Downloads();
  const now = Date.now();
  const stallMs = envMinutes('JD2_STALL_MINUTES', 15) * 60_000;
  const missingMs = envMinutes('JD2_MISSING_JOB_MINUTES', 10) * 60_000;
  const captchaMs = envMinutes('JD2_CAPTCHA_FALLBACK_MINUTES', 30) * 60_000;

  for (const job of jobs) {
    try {
      const candidates = packages.filter(pkg =>
        (job.jdPackageId && String(pkg.uuid) === String(job.jdPackageId)) ||
        (!job.jdPackageId && pkg.name === job.packageName)
      );
      const completedCandidate = candidates.find(candidate =>
        classifyDownload(candidate, packageLinks(links, String(candidate.uuid)), false) === 'completed'
      );
      const pkg = (job.jdPackageId ? candidates.find(candidate => String(candidate.uuid) === String(job.jdPackageId)) : null)
        || completedCandidate
        || candidates.find(candidate => candidate.running)
        || candidates.find(candidate => !candidate.finished)
        || candidates[0];

      if (!pkg) {
        const sentAt = new Date(job.sentAt || 0).getTime();
        if (sentAt > 0 && now - sentAt >= missingMs) {
          if ((job.retryCount || 0) < 1 && job.currentHost) {
            await dispatchHost(job, job.currentHost, 'JD2 did not create the API job.');
          } else {
            await AutoDownloadJob.updateOne(
              { _id: job._id },
              { $set: { status: 'error', message: 'JD2 did not create the API job.', lastStatusAt: new Date() } },
            );
          }
        }
        continue;
      }

      const packageId = String(pkg.uuid);
      const currentLinks = packageLinks(links, packageId);
      const progressBytes = Math.max(Number(pkg.bytesLoaded || 0), currentLinks.reduce((sum, link) => sum + Number(link.bytesLoaded || 0), 0));
      const totalBytes = Math.max(Number(pkg.bytesTotal || 0), currentLinks.reduce((sum, link) => sum + Number(link.bytesTotal || 0), 0));
      const lastProgressAt = new Date(job.lastProgressAt || job.sentAt || 0).getTime();
      const madeProgress = progressBytes > Number(job.progressBytes || 0);
      const unfinished = !pkg.finished && (currentLinks.length === 0 || currentLinks.some(link => !link.finished));
      const stalled = unfinished && !madeProgress && lastProgressAt > 0 && now - lastProgressAt >= stallMs;
      const state = classifyDownload(pkg, currentLinks, stalled);
      const statusText = [pkg.status, ...currentLinks.map(link => link.status)].filter(Boolean).join(' | ');

      await AutoDownloadJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status: state,
            jdPackageId: packageId,
            jdLinkIds: currentLinks.map(link => String(link.uuid)),
            progressBytes,
            totalBytes,
            speedBytesPerSecond: Math.max(Number(pkg.speed || 0), ...currentLinks.map(link => Number(link.speed || 0))),
            etaSeconds: Number(pkg.eta || 0),
            message: statusText || state,
            lastStatusAt: new Date(),
            ...(madeProgress ? { lastProgressAt: new Date() } : {}),
          },
        },
      );

      if (['offline', 'error', 'stalled'].includes(state)) {
        await failOver(job, currentLinks, `JD2 reported ${state}${statusText ? `: ${statusText}` : ''}.`);
      } else if (state === 'captcha' && envFlag('JD2_FALLBACK_ON_CAPTCHA')) {
        const statusAge = new Date(job.lastProgressAt || job.sentAt || 0).getTime();
        if (statusAge > 0 && now - statusAge >= captchaMs) {
          await failOver(job, currentLinks, 'JD2 is still waiting for a captcha.');
        }
      } else if (state === 'completed') {
        const profile = await getLocalProfile();
        await runLibraryScan(profile.id).catch(error => {
          logger.warn(`Post-download library scan failed for ${job.gameTitle}:`, error);
        });
      }
    } catch (error) {
      logger.error(`JD2 monitor failed for ${job.gameTitle}:`, error);
    }
  }
}
