import fs from 'node:fs/promises';
import path from 'node:path';
import { AutoDownloadJob } from './models';
import { isTorrentUrl } from './downloadLinks';
import { addTorrentToQbit, isQbitConfigured } from './qbittorrent';
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

/**
 * Same as DispatchParams, but a manual send may target an untracked game and
 * may carry links the user picked themselves.
 */
type ManualDispatchParams = Omit<DispatchParams, 'trackedGameId'> & {
  trackedGameId?: string;
  /** Set when the user chose these links, bypassing host-priority filtering. */
  ignoreHostPriority?: boolean;
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

type AutoDownloader = 'jd2-folderwatch' | 'qbittorrent' | 'mixed';

type AutoDispatchResult = Jd2DispatchResult & {
  downloader: AutoDownloader;
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

/**
 * JD2's folder watch is for direct hoster links only. Magnets are not usable
 * there, and a .torrent URL would just be fetched as a file rather than handed
 * to a torrent client — both belong in qBittorrent instead (see lib/qbittorrent).
 */
function isDispatchableUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  return !isTorrentUrl(url);
}

export function sortDownloadLinksByJd2Hierarchy(
  links: AutoDownloadLink[],
  hierarchy = getHostHierarchy(),
  options: { ignoreHostPriority?: boolean } = {},
): Array<AutoDownloadLink & { hostKey: string }> {
  const seen = new Set<string>();
  const selected = links
    .map(link => ({ ...link, hostKey: detectHost(link) }))
    .filter(link => {
      const url = String(link.url || '').trim();
      if (!url) return false;
      // Applies to explicit sends too: choosing a magnet does not make JD2 able
      // to act on it, so it is filtered rather than dispatched into a no-op.
      if (!isDispatchableUrl(url)) return false;
      // The hierarchy exists to pick a host on the user's behalf. When they
      // picked the link themselves there is nothing left to choose, so honour
      // it even if the host isn't listed.
      if (!options.ignoreHostPriority && !hierarchy.includes(link.hostKey)) return false;
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Unlisted hosts sort last rather than being dropped.
  const rank = (hostKey: string) => {
    const index = hierarchy.indexOf(hostKey);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  return selected.sort((a, b) => {
    const hostDelta = rank(a.hostKey) - rank(b.hostKey);
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

function selectTorrentLinks(links: AutoDownloadLink[]): AutoDownloadLink[] {
  const seen = new Set<string>();

  return links.filter(link => {
    const url = String(link.url || '').trim();
    if (!url || !isTorrentUrl(url, link.type, link.service)) return false;

    const key = url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Builds the crawljob's `downloadFolder`. "Remote" is literal: the result is
 * resolved by JDownloader in its own container, never opened by this process,
 * so it must be expressed in JD2's filesystem (e.g. /output) rather than this
 * container's mount of the same storage. Windows separators are honoured for
 * setups where JD2 runs on a Windows host.
 */
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

  // The watched folder is shared with a separate JD2 process that must both
  // read the job and delete it once handled. Whoever JD2 runs as rarely matches
  // this process, and an inherited ACL or a restrictive umask (notably on
  // ZFS/TrueNAS) can leave the file unreadable to it — which looks exactly like
  // JD2 ignoring the job. Widen the mode so ownership stops mattering.
  // Failure here is not fatal: the default mode still works when the two
  // processes share a user.
  const mode = parseCrawlJobMode();
  await fs.chmod(tempPath, mode).catch(error => {
    logger.debug(`Could not chmod crawljob to ${mode.toString(8)}:`, error);
  });

  try {
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
  return finalPath;
}

/** File mode for written crawljobs. Octal string, e.g. "666" (the default). */
function parseCrawlJobMode(): number {
  const raw = (process.env.JD2_CRAWLJOB_MODE || '').trim();
  if (!raw) return 0o666;
  const parsed = parseInt(raw, 8);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 0o777) {
    logger.warn(`Ignoring invalid JD2_CRAWLJOB_MODE "${raw}"; using 666.`);
    return 0o666;
  }
  return parsed;
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
  params: Pick<DispatchParams, 'gameTitle' | 'version' | 'gameLink' | 'downloadLinks'> & {
    ignoreHostPriority?: boolean;
  },
): Promise<Jd2DispatchResult> {
  const hierarchy = getHostHierarchy();
  const sortedLinks = sortDownloadLinksByJd2Hierarchy(params.downloadLinks || [], hierarchy, {
    ignoreHostPriority: params.ignoreHostPriority,
  });
  const packageName = buildPackageName(params.gameTitle, params.version);
  const selectedHosts = [...new Set(sortedLinks.map(link => link.hostKey))];

  const base = { packageName, linkCount: sortedLinks.length, selectedHosts, hierarchy };

  if (!sortedLinks.length) {
    return {
      ...base,
      ok: false,
      outcome: 'skipped',
      message: params.ignoreHostPriority
        ? 'JDownloader cannot take that link. Magnet and .torrent links need to go to qBittorrent instead.'
        : `No links from a preferred host (${hierarchy.join(', ')}) were found for this release.`,
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

async function performQbitDispatch(
  params: Pick<DispatchParams, 'gameTitle' | 'version' | 'downloadLinks'>,
): Promise<Jd2DispatchResult> {
  const torrentLinks = selectTorrentLinks(params.downloadLinks || []);
  const packageName = buildPackageName(params.gameTitle, params.version);
  const base = {
    packageName,
    linkCount: torrentLinks.length,
    selectedHosts: torrentLinks.map(link => link.service || 'torrent'),
    hierarchy: ['qbittorrent'],
  };

  if (!torrentLinks.length) {
    return {
      ...base,
      ok: false,
      outcome: 'skipped',
      message: 'No magnet or .torrent links were found for this release.',
    };
  }

  if (!isQbitConfigured()) {
    return {
      ...base,
      ok: false,
      outcome: 'skipped',
      message: 'qBittorrent is not configured; set QBITTORRENT_URL to auto-add torrent links.',
    };
  }

  const results = await Promise.all(
    torrentLinks.map(link => addTorrentToQbit({
      url: link.url,
      gameTitle: params.gameTitle,
    })),
  );

  const addedCount = results.filter(result => result.ok).length;
  if (addedCount === torrentLinks.length) {
    return {
      ...base,
      ok: true,
      outcome: 'sent',
      message: `Sent ${addedCount} torrent link(s) to qBittorrent.`,
    };
  }

  const failures = results
    .filter(result => !result.ok)
    .map(result => result.message);

  if (addedCount > 0) {
    return {
      ...base,
      ok: true,
      outcome: 'sent',
      message: `Sent ${addedCount} of ${torrentLinks.length} torrent link(s) to qBittorrent. ${failures[0] || ''}`.trim(),
    };
  }

  return {
    ...base,
    ok: false,
    outcome: 'failed',
    message: failures[0] || 'qBittorrent did not accept any torrent links.',
  };
}

function combineAutoDispatchResults(
  jd2: Jd2DispatchResult,
  qbit: Jd2DispatchResult,
): AutoDispatchResult {
  const sentJd2 = jd2.outcome === 'sent';
  const sentQbit = qbit.outcome === 'sent';
  const downloader: AutoDownloader =
    sentJd2 && sentQbit ? 'mixed'
    : sentQbit ? 'qbittorrent'
    : 'jd2-folderwatch';
  const failures = [jd2, qbit].filter(result => result.outcome === 'failed');
  const outcome: Jd2DispatchOutcome =
    sentJd2 || sentQbit ? 'sent'
    : failures.length > 0 ? 'failed'
    : 'skipped';
  const messages = [jd2.message, qbit.message].filter(Boolean);

  return {
    ok: sentJd2 || sentQbit,
    outcome,
    message: messages.join(' '),
    packageName: jd2.packageName || qbit.packageName,
    linkCount: jd2.linkCount + qbit.linkCount,
    selectedHosts: [...new Set([...jd2.selectedHosts, ...qbit.selectedHosts])],
    hierarchy: [...new Set([...jd2.hierarchy, ...qbit.hierarchy])],
    outputFile: jd2.outputFile,
    downloader,
  };
}

/** Persist the outcome of a dispatch against its tracked game. */
async function recordAutoDownloadJob(
  params: DispatchParams,
  result: AutoDispatchResult,
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
        downloader: result.downloader,
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

  const [jd2Result, qbitResult] = await Promise.all([
    performJd2Dispatch(params),
    performQbitDispatch(params),
  ]);
  const result = combineAutoDispatchResults(jd2Result, qbitResult);
  await recordAutoDownloadJob(params, result);

  if (jd2Result.ok) {
    logger.info(`Sent ${jd2Result.linkCount} auto-download link(s) to JD2 for ${params.gameTitle}`);
  }
  if (qbitResult.ok) {
    logger.info(`Sent ${qbitResult.linkCount} auto-download torrent link(s) to qBittorrent for ${params.gameTitle}`);
  }

  if (result.ok) {
    logger.info(`Auto-download dispatched for ${params.gameTitle} via ${result.downloader}`);
  } else if (result.outcome === 'skipped') {
    logger.info(`Auto-download skipped for ${params.gameTitle}: ${result.message}`);
  } else {
    logger.error(`Failed to dispatch auto-download for ${params.gameTitle}: ${result.message}`);
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
      await recordAutoDownloadJob(
        { ...params, trackedGameId: params.trackedGameId },
        { ...result, downloader: 'jd2-folderwatch' },
      );
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
