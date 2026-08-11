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
  const autoStart = envFlag('JD2_AUTO_START', true) ? 'TRUE' : 'FALSE';
  const autoConfirm = envFlag('JD2_AUTO_CONFIRM', true) ? 'TRUE' : 'FALSE';
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
    overwritePackagizerEnabled: false,
    ...(downloadFolder ? { downloadFolder } : {}),
  }];

  const finalPath = path.join(params.watchDir, safeJobFileName(params.packageName));
  const tempPath = `${finalPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(job, null, 2), 'utf8');
  await fs.rename(tempPath, finalPath);
  return finalPath;
}

export async function dispatchAutoDownloadToJd2(params: DispatchParams): Promise<boolean> {
  if (!envFlag('JD2_AUTO_DOWNLOADS_ENABLED') && !envFlag('AUTO_DOWNLOADS_ENABLED')) {
    return false;
  }

  const hierarchy = getHostHierarchy();
  const sortedLinks = sortDownloadLinksByJd2Hierarchy(params.downloadLinks || [], hierarchy);
  const packageName = buildPackageName(params.gameTitle, params.version);
  const selectedHosts = [...new Set(sortedLinks.map(link => link.hostKey))];

  const existing = await AutoDownloadJob.findOne({
    trackedGameId: params.trackedGameId,
    gameLink: params.gameLink,
  }).lean<ExistingAutoDownloadJob | null>();

  if (existing?.status && ['queued', 'sent'].includes(existing.status)) {
    logger.info(`JD2 auto-download already dispatched for ${params.gameTitle}: ${params.gameLink}`);
    return false;
  }

  const baseJob = {
    userId: params.userId,
    trackedGameId: params.trackedGameId,
    gameTitle: params.gameTitle,
    version: params.version || '',
    gameLink: params.gameLink,
    packageName,
    downloader: 'jd2-folderwatch',
    linkCount: sortedLinks.length,
    selectedHosts,
    hierarchy,
  };

  if (!sortedLinks.length) {
    await AutoDownloadJob.findOneAndUpdate(
      { trackedGameId: params.trackedGameId, gameLink: params.gameLink },
      {
        $set: {
          ...baseJob,
          status: 'skipped',
          message: `No preferred host links found (${hierarchy.join(', ')})`,
        },
      },
      { upsert: true, new: true },
    );
    logger.info(`JD2 auto-download skipped for ${params.gameTitle}: no preferred host links`);
    return false;
  }

  const watchDir = process.env.JD2_FOLDERWATCH_DIR || process.env.JDOWNLOADER_FOLDERWATCH_DIR || '';
  if (!watchDir.trim()) {
    await AutoDownloadJob.findOneAndUpdate(
      { trackedGameId: params.trackedGameId, gameLink: params.gameLink },
      {
        $set: {
          ...baseJob,
          status: 'failed',
          message: 'Set JD2_FOLDERWATCH_DIR to enable JD2 Folder Watch dispatch.',
        },
      },
      { upsert: true, new: true },
    );
    logger.warn('JD2 auto-download enabled but JD2_FOLDERWATCH_DIR is not set.');
    return false;
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

    await AutoDownloadJob.findOneAndUpdate(
      { trackedGameId: params.trackedGameId, gameLink: params.gameLink },
      {
        $set: {
          ...baseJob,
          status: 'sent',
          outputFile,
          message: `Sent ${sortedLinks.length} link(s) to JD2 Folder Watch.`,
          sentAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
    logger.info(`Sent ${sortedLinks.length} auto-download link(s) to JD2 for ${params.gameTitle}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to write JD2 crawljob';
    await AutoDownloadJob.findOneAndUpdate(
      { trackedGameId: params.trackedGameId, gameLink: params.gameLink },
      {
        $set: {
          ...baseJob,
          status: 'failed',
          message,
        },
      },
      { upsert: true, new: true },
    );
    logger.error(`Failed to dispatch JD2 auto-download for ${params.gameTitle}:`, error);
    return false;
  }
}
