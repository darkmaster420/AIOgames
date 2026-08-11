import fs from 'node:fs/promises';
import path from 'node:path';
import { AutoDownloadJob } from './models';
import logger from '../utils/logger';

export type AutoDownloadLink = {
  service?: string;
  url: string;
  type?: string;
};

type DispatchParams = {
  userId: string;
  trackedGameId: string;
  gameTitle: string;
  version?: string;
  gameLink: string;
  downloadLinks?: AutoDownloadLink[];
};

/** Same as DispatchParams, but a manual send may target an untracked game. */
type ManualDispatchParams = Omit<DispatchParams, 'trackedGameId'> & {
  trackedGameId?: string;
};

export type Jd2DispatchOutcome = 'sent' | 'skipped' | 'failed' | 'disabled' | 'duplicate';

export type Jd2DispatchResult = {
  ok: boolean;
  outcome: Jd2DispatchOutcome;
  message: string;
  packageName: string;
  linkCount: number;
  selectedHosts: string[];
  hierarchy: string[];
  outputFile?: string;
};

type ExistingAutoDownloadJob = {
  status?: string;
};

const DEFAULT_HOST_HIERARCHY = ['gofile', 'pixeldrain', 'mediafire', 'datanodes'];

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function getHostHierarchy(): string[] {
  const raw = process.env.JD2_HOST_PRIORITY || process.env.AUTO_DOWNLOAD_HOST_PRIORITY;
  const values = raw
    ? raw.split(',').map(v => normalizeHostKey(v)).filter(Boolean)
    : DEFAULT_HOST_HIERARCHY;
  return [...new Set(values)];
}

function normalizeHostKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectHost(link: AutoDownloadLink): string {
  const service = normalizeHostKey(link.service || '');
  const url = normalizeHostKey(link.url || '');

  if (service.includes('gofile') || url.includes('gofileio')) return 'gofile';
  if (service.includes('pixeldrain') || url.includes('pixeldraincom')) return 'pixeldrain';
  if (service.includes('mediafire') || url.includes('mediafirecom')) return 'mediafire';
  if (service.includes('datanodes') || url.includes('datanodes')) return 'datanodes';
  return service || 'unknown';
}

export function sortDownloadLinksByJd2Hierarchy(
  links: AutoDownloadLink[],
  hierarchy = getHostHierarchy(),
): Array<AutoDownloadLink & { hostKey: string }> {
  const seen = new Set<string>();
  const preferred = links
    .map(link => ({ ...link, hostKey: detectHost(link) }))
    .filter(link => {
      const url = String(link.url || '').trim();
      if (!url) return false;
      if (!/^https?:\/\//i.test(url)) return false;
      if (!hierarchy.includes(link.hostKey)) return false;
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return preferred.sort((a, b) => {
    const hostDelta = hierarchy.indexOf(a.hostKey) - hierarchy.indexOf(b.hostKey);
    if (hostDelta !== 0) return hostDelta;
    return a.url.localeCompare(b.url);
  });
}

function sanitizePackagePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function buildPackageName(gameTitle: string, version?: string): string {
  const title = sanitizePackagePart(gameTitle) || 'AIOgames Download';
  const versionPart = sanitizePackagePart(version || '');
  return versionPart && !title.toLowerCase().includes(versionPart.toLowerCase())
    ? `${title} - ${versionPart}`
    : title;
}

function joinRemoteDownloadPath(root: string, packageName: string): string {
  const trimmed = root.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return '';
  const separator = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.includes('\\') ? '\\' : '/';
  return `${trimmed}${separator}${packageName}`;
}

function safeJobFileName(packageName: string): string {
  const base = sanitizePackagePart(packageName)
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 100) || 'aiogames-download';
  return `${Date.now()}-${base}.crawljob`;
}

async function writeCrawlJob(params: {
  watchDir: string;
  packageName: string;
  links: Array<AutoDownloadLink & { hostKey: string }>;
  hierarchy: string[];
  version?: string;
  gameLink: string;
}): Promise<string> {
  await fs.mkdir(params.watchDir, { recursive: true });

  const downloadRoot = process.env.JD2_DOWNLOAD_ROOT || process.env.AUTO_DOWNLOAD_ROOT || '';
  // JD2 parses enabled/autoConfirm/autoStart/forcedStart as its BooleanStatus
  // enum, so these are the strings 'TRUE'/'FALSE' rather than JSON booleans.
  // deepAnalyseEnabled and overwritePackagizerEnabled are real booleans there.
  const autoStart = envFlag('JD2_AUTO_START', true) ? 'TRUE' : 'FALSE';
  const autoConfirm = envFlag('JD2_AUTO_CONFIRM', true) ? 'TRUE' : 'FALSE';
  // JD2 uses this only to decide whether the job's downloadFolder overrides a
  // matching Packagizer rule. Default false keeps the Packagizer authoritative.
  const overwritePackagizer = envFlag('JD2_OVERWRITE_PACKAGIZER', false);
  const downloadFolder = downloadRoot
    ? joinRemoteDownloadPath(downloadRoot, params.packageName)
    : undefined;

  const job = [{
    text: params.links.map(link => link.url).join('\n'),
    packageName: params.packageName,
    comment: [
      'AIOgames auto-download',
      params.version ? `Version: ${params.version}` : '',
      `Hierarchy: ${params.hierarchy.join(' > ')}`,
      `Source: ${params.gameLink}`,
    ].filter(Boolean).join(' | '),
    enabled: 'TRUE',
    autoConfirm,
    autoStart,
    forcedStart: autoStart,
    deepAnalyseEnabled: true,
    overwritePackagizerEnabled: overwritePackagizer,
    ...(downloadFolder ? { downloadFolder } : {}),
  }];

  // Write to `.tmp` then rename, so JD2's folder watch never picks up a
  // half-written .crawljob. Clean the temp file up if the rename fails,
  // otherwise a failed dispatch leaves litter in the watched folder.
  const finalPath = path.join(params.watchDir, safeJobFileName(params.packageName));
  const tempPath = `${finalPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(job, null, 2), 'utf8');
  try {
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
  return finalPath;
}

/**
 * Turns a filesystem errno into something the operator can act on. The watch
 * directory is almost always a bind mount, so failures here are permission or
 * mount problems rather than bugs, and the raw errno doesn't say which.
 */
function describeWatchDirError(error: unknown, watchDir: string): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: string }).code)
    : '';

  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return `Cannot write to the JD2 watch folder (${watchDir}): permission denied. `
        + 'The container runs as uid 1001, so the mounted folder must be writable by it '
        + '(e.g. chown -R 1001:1001 on the host path backing this mount).';
    case 'ENOENT':
      return `The JD2 watch folder (${watchDir}) does not exist and could not be created. `
        + 'Check that the volume is mounted and JD2_FOLDERWATCH_DIR points at it.';
    case 'EROFS':
      return `The JD2 watch folder (${watchDir}) is mounted read-only. `
        + 'Remove the :ro flag from that volume so crawljobs can be written.';
    case 'ENOSPC':
      return `No space left on the device holding the JD2 watch folder (${watchDir}).`;
    default:
      return error instanceof Error ? error.message : 'Failed to write JD2 crawljob';
  }
}

/** True when the scheduled update-check pipeline is allowed to dispatch on its own. */
export function isJd2AutoDispatchEnabled(): boolean {
  return envFlag('JD2_AUTO_DOWNLOADS_ENABLED') || envFlag('AUTO_DOWNLOADS_ENABLED');
}

export function getJd2WatchDir(): string {
  return (process.env.JD2_FOLDERWATCH_DIR || process.env.JDOWNLOADER_FOLDERWATCH_DIR || '').trim();
}

/**
 * Link selection + crawljob write, with no database side effects.
 *
 * Shared by the automatic pipeline and the manual "Send to JD2" action so the
 * two can never drift on host priority, package naming or crawljob format.
 */
export async function performJd2Dispatch(
  params: Pick<DispatchParams, 'gameTitle' | 'version' | 'gameLink' | 'downloadLinks'>,
): Promise<Jd2DispatchResult> {
  const hierarchy = getHostHierarchy();
  const sortedLinks = sortDownloadLinksByJd2Hierarchy(params.downloadLinks || [], hierarchy);
  const packageName = buildPackageName(params.gameTitle, params.version);
  const selectedHosts = [...new Set(sortedLinks.map(link => link.hostKey))];

  const base = { packageName, linkCount: sortedLinks.length, selectedHosts, hierarchy };

  if (!sortedLinks.length) {
    return {
      ...base,
      ok: false,
      outcome: 'skipped',
      message: `No links from a preferred host (${hierarchy.join(', ')}) were found for this release.`,
    };
  }

  const watchDir = getJd2WatchDir();
  if (!watchDir) {
    return {
      ...base,
      ok: false,
      outcome: 'failed',
      message: 'Set JD2_FOLDERWATCH_DIR to enable JD2 Folder Watch dispatch.',
    };
  }

  try {
    const outputFile = await writeCrawlJob({
      watchDir,
      packageName,
      links: sortedLinks,
      hierarchy,
      version: params.version,
      gameLink: params.gameLink,
    });

    return {
      ...base,
      ok: true,
      outcome: 'sent',
      outputFile,
      message: `Sent ${sortedLinks.length} link(s) to JD2 Folder Watch.`,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      outcome: 'failed',
      message: describeWatchDirError(error, watchDir),
    };
  }
}

/** Persist the outcome of a dispatch against its tracked game. */
async function recordAutoDownloadJob(
  params: DispatchParams,
  result: Jd2DispatchResult,
): Promise<void> {
  await AutoDownloadJob.findOneAndUpdate(
    { trackedGameId: params.trackedGameId, gameLink: params.gameLink },
    {
      $set: {
        userId: params.userId,
        trackedGameId: params.trackedGameId,
        gameTitle: params.gameTitle,
        version: params.version || '',
        gameLink: params.gameLink,
        packageName: result.packageName,
        downloader: 'jd2-folderwatch',
        linkCount: result.linkCount,
        selectedHosts: result.selectedHosts,
        hierarchy: result.hierarchy,
        status: result.outcome === 'sent' ? 'sent' : result.outcome === 'skipped' ? 'skipped' : 'failed',
        message: result.message,
        ...(result.outputFile ? { outputFile: result.outputFile } : {}),
        ...(result.outcome === 'sent' ? { sentAt: new Date() } : {}),
      },
    },
    { upsert: true, new: true },
  );
}

/**
 * Automatic dispatch from the update-check pipeline. Gated behind the
 * auto-download env flag and skips releases already dispatched.
 */
export async function dispatchAutoDownloadToJd2(params: DispatchParams): Promise<boolean> {
  if (!isJd2AutoDispatchEnabled()) {
    return false;
  }

  const existing = await AutoDownloadJob.findOne({
    trackedGameId: params.trackedGameId,
    gameLink: params.gameLink,
  }).lean<ExistingAutoDownloadJob | null>();

  if (existing?.status && ['queued', 'sent'].includes(existing.status)) {
    logger.info(`JD2 auto-download already dispatched for ${params.gameTitle}: ${params.gameLink}`);
    return false;
  }

  const result = await performJd2Dispatch(params);
  await recordAutoDownloadJob(params, result);

  if (result.ok) {
    logger.info(`Sent ${result.linkCount} auto-download link(s) to JD2 for ${params.gameTitle}`);
  } else if (result.outcome === 'skipped') {
    logger.info(`JD2 auto-download skipped for ${params.gameTitle}: no preferred host links`);
  } else {
    logger.error(`Failed to dispatch JD2 auto-download for ${params.gameTitle}: ${result.message}`);
  }

  return result.ok;
}

/**
 * Manual dispatch triggered by the user from the UI.
 *
 * Differs from the automatic path in three ways, all deliberate:
 *  - not gated by the auto-download env flag; that flag governs unattended
 *    dispatch, and an explicit click is consent on its own,
 *  - re-sends a release that was already dispatched, because asking again is
 *    the normal way to recover from a download the user cancelled in JD2,
 *  - tolerates an untracked game. The AutoDownloadJob ledger requires a
 *    tracked game, so an untracked send still reaches JD2 but isn't recorded.
 */
export async function dispatchManualDownloadToJd2(
  params: ManualDispatchParams,
): Promise<Jd2DispatchResult> {
  const result = await performJd2Dispatch(params);

  if (params.trackedGameId) {
    try {
      await recordAutoDownloadJob({ ...params, trackedGameId: params.trackedGameId }, result);
    } catch (error) {
      // Bookkeeping must not mask a crawljob that was written successfully.
      logger.warn(`Could not record manual JD2 job for ${params.gameTitle}:`, error);
    }
  }

  if (result.ok) {
    logger.info(`Manual JD2 send: ${result.linkCount} link(s) for ${params.gameTitle}`);
  } else {
    logger.warn(`Manual JD2 send did not dispatch ${params.gameTitle}: ${result.message}`);
  }

  return result;
}
