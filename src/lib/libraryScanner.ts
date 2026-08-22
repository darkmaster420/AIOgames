import fs from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';
import connectDB from './db';
import { AutoDownloadJob, LibraryGame, LibraryScanJob, LibraryTrackingExclusion, TrackedGame } from './models';
import { getLibraryRoots } from './libraryConfig';
import { cleanupStaleLibraryArchives, type LibraryFileEntry } from './libraryCleanup';
import {
  ARCHIVE_EXTENSIONS,
  compareLibraryReleaseInfo,
  normalizeLibraryTitle,
  parseLibraryReleaseInfo,
  stripArchiveExtension,
  type LibraryReleaseInfo,
} from './libraryTitle';
import { autoVerifyWithSteamLadderForTrack } from '../utils/autoSteamVerification';
import { resolveIGDBImage } from '../utils/igdb';
import { cleanGameTitle, calculateGamePriority } from '../utils/steamApi';
import logger from '../utils/logger';

type ExistingLibraryGame = {
  _id: unknown;
  contentKey?: string;
};

type ExistingTrackedGame = {
  _id: unknown;
  gameId?: string;
  source?: string;
  gameLink?: string;
  currentVersionNumber?: string;
  currentBuildNumber?: string;
  lastKnownVersion?: string;
  isDateVersion?: boolean;
  latestApprovedUpdate?: {
    dateFound?: string | Date;
    gameLink?: string;
    siteType?: string;
  };
  updateHistory?: Array<{
    dateFound?: string | Date;
    gameLink?: string;
    siteType?: string;
  }>;
};

const ARCHIVE_EXTENSION_SET = new Set<string>(ARCHIVE_EXTENSIONS);

/** Top-level folders that hold other things rather than being a release. */
const IGNORED_DIRECTORY_NAMES = new Set(['backups', 'repacks', 'temp', 'tmp', 'incomplete', '$recycle.bin']);

function isLikelyInstallerPart(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower === 'setup.exe') return true;
  if (/^setup([ ._-]|$)/.test(lower)) return true;
  if (lower === 'goggame-setup.exe') return true;
  if (lower.endsWith('.doi')) return true;
  if (lower.endsWith('.fg') || lower.includes('.fg-')) return true;
  if (lower.startsWith('fg-')) return true;
  if (lower.endsWith('.md5') || lower.endsWith('.sfv') || lower.endsWith('.nfo')) return true;
  if (/\.r\d{2,3}$/.test(lower)) return true;
  if (/\.(\d{3}|part\d+)$/i.test(lower)) return true;
  return false;
}

async function assertLibraryRootReadable(root: string): Promise<void> {
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) {
      throw new Error(`LIBRARY_ROOT must be a directory: ${root}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('LIBRARY_ROOT must')) {
      throw error;
    }

    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code)
        : 'error';
    const message = error instanceof Error ? error.message : String(error);
    const help = process.platform === 'win32'
      ? 'Use a UNC path like \\\\YourNAS\\Games if mapped drives are not visible to the Node process.'
      : 'Check that the path exists and the process can read it.';

    throw new Error(`Cannot read library folder: ${root} (${code}: ${message}). ${help}`);
  }
}

/**
 * A top-level directory counts as a library entry when its name parses like a
 * release (carries a version or build), e.g. `Outbound.v1.1.7.969-P2`. Without
 * that test every incidental folder in the library root would be imported as a
 * game.
 */
function isLikelyReleaseDirectory(name: string): boolean {
  if (name.startsWith('.') || IGNORED_DIRECTORY_NAMES.has(name.toLowerCase())) return false;
  const release = parseLibraryReleaseInfo(name);
  return Boolean(release.version || release.build);
}

async function collectRootArchives(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (isLikelyInstallerPart(entry.name)) continue;

    if (entry.isFile()) {
      if (!ARCHIVE_EXTENSION_SET.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(path.join(root, entry.name));
      continue;
    }

    // Extracted releases live as folders alongside the archives.
    if (entry.isDirectory() && isLikelyReleaseDirectory(entry.name)) {
      files.push(path.join(root, entry.name));
    }
  }

  return files;
}

function contentKey(stat: Stats): string {
  return `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
}

function buildTrackedReleaseFields(release: LibraryReleaseInfo, stat: Stats, relativePath: string) {
  const fields: Record<string, unknown> = {
    lastKnownVersion: release.lastKnownVersion,
    lastVersionDate: new Date(stat.mtimeMs).toISOString(),
    description: `Imported from library: ${relativePath}`,
  };

  if (release.version) {
    fields.currentVersionNumber = release.version;
    fields.versionNumberVerified = true;
    fields.versionNumberSource = 'local-library';
    fields.versionNumberLastUpdated = new Date();
    fields.isDateVersion = release.isDateVersion;
  }

  if (release.build) {
    fields.currentBuildNumber = release.build;
    fields.buildNumberVerified = true;
    fields.buildNumberSource = 'local-library';
    fields.buildNumberLastUpdated = new Date();
  }

  return fields;
}

function isCandidateReleaseNewer(existing: ExistingTrackedGame, candidate: LibraryReleaseInfo): boolean {
  if (!candidate.version && !candidate.build) return false;
  return compareLibraryReleaseInfo(
    {
      version: existing.currentVersionNumber || '',
      build: existing.currentBuildNumber || '',
      isDateVersion: Boolean(existing.isDateVersion),
    },
    candidate,
  ) > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function displaySource(siteType?: string): string | null {
  const sources: Record<string, string> = {
    freegog: 'Free GOG PC Games',
    fitgirl: 'FitGirl Repacks',
    onlinefix: 'Online-Fix',
    reloadedsteam: 'Reloaded Steam',
    skidrow: 'Skidrow Reloaded',
    steamrip: 'SteamRip',
    steamunderground: 'Steam Underground',
  };
  return sources[String(siteType || '').toLowerCase()] || null;
}

/** Repair rows affected by the old scanner without replacing remote identity. */
function remoteSourceRepairFields(game: ExistingTrackedGame): Record<string, string> {
  if (String(game.gameId || '').startsWith('library:')) return {};
  const sourceWasOverwritten = game.source === 'Local Library' || String(game.gameLink || '').startsWith('library://');
  if (!sourceWasOverwritten) return {};

  const latestRemote = [
    ...(game.latestApprovedUpdate ? [game.latestApprovedUpdate] : []),
    ...(game.updateHistory || []),
  ]
    .filter(row => /^https?:\/\//i.test(String(row.gameLink || '')))
    .sort((a, b) => new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime())[0];

  if (!latestRemote?.gameLink) return {};
  const siteType = latestRemote.siteType || String(game.gameId || '').split('_')[0];
  return {
    gameLink: latestRemote.gameLink,
    ...(displaySource(siteType) ? { source: displaySource(siteType)! } : {}),
  };
}

function normalizedReleaseToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function reconcileLocalDownload(
  trackedGameId: unknown,
  release: LibraryReleaseInfo,
  fileName: string,
): Promise<void> {
  const tokens = [release.version, release.build]
    .map(normalizedReleaseToken)
    .filter(token => token.length >= 2);
  if (!tokens.length) return;

  const jobs = await AutoDownloadJob.find({
    trackedGameId,
    status: { $nin: ['completed', 'skipped'] },
  }).sort({ updatedAt: -1 }).limit(5);

  const matchingJob = jobs.find(job => {
    const haystack = normalizedReleaseToken(`${job.version || ''} ${job.packageName || ''}`);
    return tokens.some(token => haystack.includes(token));
  });
  if (!matchingJob) return;

  matchingJob.status = 'completed';
  matchingJob.message = `Found downloaded release in shared library: ${fileName}`;
  matchingJob.lastStatusAt = new Date();
  matchingJob.speedBytesPerSecond = 0;
  matchingJob.etaSeconds = 0;
  await matchingJob.save();
}

/**
 * Resolves a Steam AppID (and poster art) for a freshly imported library game.
 *
 * Mirrors what `POST /api/tracking` does for games tracked from a site — the
 * scanner previously skipped it entirely, which is why NAS imports had no
 * AppID and were never checked against SteamDB for updates.
 *
 * Never throws: a failed lookup must not fail the scan.
 */
async function verifyLibraryGameOnSteam(
  trackedGameId: unknown,
  title: string,
  cleanedTitle: string,
): Promise<boolean> {
  try {
    const verification = await autoVerifyWithSteamLadderForTrack(title, cleanedTitle);

    const update: Record<string, unknown> = {};
    if (verification.success && verification.steamAppId && verification.steamName) {
      update.steamVerified = true;
      update.steamAppId = verification.steamAppId;
      update.steamName = verification.steamName;
    }

    const image = await resolveIGDBImage(cleanedTitle || title).catch(() => null);
    if (image) update.image = image;

    if (Object.keys(update).length === 0) {
      logger.debug(`No Steam match for library game "${title}": ${verification.reason}`);
      return false;
    }

    await TrackedGame.updateOne({ _id: trackedGameId }, { $set: update });
    if (update.steamAppId) {
      logger.info(`Steam-verified library game "${title}" → ${update.steamName} (${update.steamAppId})`);
    }
    return Boolean(update.steamAppId);
  } catch (error) {
    logger.warn(`Steam verification failed for library game "${title}":`, error);
    return false;
  }
}

export type LibraryScanStats = {
  filesSeen: number;
  gamesUpserted: number;
  gamesSkipped: number;
  gamesRemoved: number;
  /** Old archive versions removed by the opt-in retention policy. */
  staleFilesDeleted: number;
  staleDeleteErrors: number;
  trackedCreated: number;
  trackedExisting: number;
  /** Releases the user explicitly chose not to track. */
  trackedExcluded: number;
  /** Newly imported games that resolved to a Steam AppID. */
  trackedVerified: number;
  errors: number;
};

let scanInFlight: Promise<LibraryScanStats> | null = null;

export async function runLibraryScan(userId?: string): Promise<LibraryScanStats> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = runLibraryScanInternal(userId).finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

async function runLibraryScanInternal(userId?: string): Promise<LibraryScanStats> {
  await connectDB();

  const roots = getLibraryRoots();
  if (!roots.length) {
    throw new Error('Set LIBRARY_ROOT or GAME_LIBRARY_ROOT to enable NAS library scans.');
  }

  const startedAt = new Date();
  const job = await LibraryScanJob.create({ status: 'running', startedAt });
  const stats: LibraryScanStats = {
    filesSeen: 0,
    gamesUpserted: 0,
    gamesSkipped: 0,
    gamesRemoved: 0,
    staleFilesDeleted: 0,
    staleDeleteErrors: 0,
    trackedCreated: 0,
    trackedExisting: 0,
    trackedExcluded: 0,
    trackedVerified: 0,
    errors: 0,
  };

  try {
    await Promise.all(roots.map(assertLibraryRootReadable));
    let files: LibraryFileEntry[] = (await Promise.all(roots.map(async root =>
      (await collectRootArchives(root)).map(filePath => ({ filePath, sourceRoot: root }))
    ))).flat();
    stats.filesSeen = files.length;
    const cleanup = await cleanupStaleLibraryArchives(files);
    files = cleanup.entries;
    stats.staleFilesDeleted = cleanup.deleted;
    stats.staleDeleteErrors = cleanup.errors;
    stats.errors += cleanup.errors;
    const exclusions = userId
      ? await LibraryTrackingExclusion.find({ userId })
          .select('normalizedTitle libraryGameId')
          .lean<Array<{ normalizedTitle: string; libraryGameId?: unknown }>>()
      : [];
    const excludedTitles = new Set(exclusions.map(exclusion => exclusion.normalizedTitle));
    const excludedLibraryIds = new Set(
      exclusions.map(exclusion => String(exclusion.libraryGameId || '')).filter(Boolean),
    );
    logger.info(
      `Library scan started: ${roots.join(', ')} (${stats.filesSeen} release(s) found, ` +
      `${files.length} retained for indexing)`,
    );

    for (const { filePath, sourceRoot } of files) {
      try {
        const stat = await fs.stat(filePath);
        const fileName = path.basename(filePath);
        const relativePath = path.relative(sourceRoot, filePath);
        const key = contentKey(stat);
        const existing = await LibraryGame.findOne({ filePath })
          .select('_id contentKey')
          .lean<ExistingLibraryGame | null>();

        let libraryGameId = existing?._id;
        const release = parseLibraryReleaseInfo(fileName);
        const title = release.title;
        const normalizedTitle = normalizeLibraryTitle(title);
        // Same cleaning the discovery/track flow applies, so a game imported
        // from the NAS and the same game tracked from a site collapse together.
        const cleanedTitle = cleanGameTitle(title);

        if (existing?.contentKey === key) {
          await LibraryGame.updateOne(
            { _id: existing._id },
            { $set: { lastSeenAt: new Date(), isActive: true } },
          );
          stats.gamesSkipped += 1;
        } else {
          const updateResult = await LibraryGame.findOneAndUpdate(
            { filePath },
            {
              $set: {
                fileName,
                relativePath,
                title,
                normalizedTitle,
                extension: stripArchiveExtension(fileName) === fileName
                  ? ''
                  : path.extname(fileName).toLowerCase(),
                fileSizeBytes: stat.size,
                mtimeMs: stat.mtimeMs,
                contentKey: key,
                lastSeenAt: new Date(),
                isActive: true,
              },
              $setOnInsert: { filePath },
            },
            { upsert: true, new: true },
          ).select('_id').lean<ExistingLibraryGame | null>();
          libraryGameId = updateResult?._id;
          stats.gamesUpserted += 1;
        }

        if (userId && libraryGameId) {
          const libraryGameIdString = String(libraryGameId);
          const gameId = `library:${libraryGameIdString}`;
          const existingTrackedByIdentity = await TrackedGame.findOne({
            userId,
            $or: [
              { gameId },
              { gameLink: `library://${libraryGameIdString}` },
            ],
          }).select('_id gameId source gameLink currentVersionNumber currentBuildNumber lastKnownVersion isDateVersion latestApprovedUpdate updateHistory').lean<ExistingTrackedGame | null>();

          if (existingTrackedByIdentity) {
            const isLocalOnly = String(existingTrackedByIdentity.gameId || '').startsWith('library:');
            await TrackedGame.updateOne(
              { _id: existingTrackedByIdentity._id },
              {
                $set: {
                  ...(isLocalOnly ? {
                    title,
                    originalTitle: title,
                    source: 'Local Library',
                    gameLink: `library://${libraryGameIdString}`,
                  } : remoteSourceRepairFields(existingTrackedByIdentity)),
                  ...buildTrackedReleaseFields(release, stat, relativePath),
                  lastChecked: new Date(),
                  isActive: true,
                },
              },
            );
            await reconcileLocalDownload(existingTrackedByIdentity._id, release, fileName);
            stats.trackedExisting += 1;
            continue;
          }

          // Case- and edition-insensitive so `FATAL.FURY...v2.0.2.zip` and
          // `rune-fatal.fury...v2.0.1.iso` resolve to the same tracked game
          // instead of creating a second card for the same title.
          const titlePattern = new RegExp(`^${escapeRegExp(title)}$`, 'i');
          const existingTrackedByTitle = await TrackedGame.findOne({
            userId,
            isActive: true,
            $or: [
              { title: titlePattern },
              { cleanedTitle: cleanedTitle },
              { originalTitle: fileName },
            ],
          }).select('_id gameId source gameLink currentVersionNumber currentBuildNumber lastKnownVersion isDateVersion latestApprovedUpdate updateHistory').lean<ExistingTrackedGame | null>();

          if (existingTrackedByTitle) {
            const sourceRepair = remoteSourceRepairFields(existingTrackedByTitle);
            const isNewer = isCandidateReleaseNewer(existingTrackedByTitle, release);
            if (isNewer || Object.keys(sourceRepair).length > 0) {
              await TrackedGame.updateOne(
                { _id: existingTrackedByTitle._id },
                {
                  $set: {
                    ...sourceRepair,
                    ...(isNewer ? buildTrackedReleaseFields(release, stat, relativePath) : {}),
                    lastChecked: new Date(),
                    isActive: true,
                  },
                },
              );
            }
            await reconcileLocalDownload(existingTrackedByTitle._id, release, fileName);
            stats.trackedExisting += 1;
          } else {
            if (excludedTitles.has(normalizedTitle) || excludedLibraryIds.has(libraryGameIdString)) {
              stats.trackedExcluded += 1;
              continue;
            }

            const created = await TrackedGame.create({
              userId,
              gameId,
              title,
              originalTitle: title,
              cleanedTitle,
              priority: calculateGamePriority(title, false),
              source: 'Local Library',
              image: '',
              ...buildTrackedReleaseFields(release, stat, relativePath),
              gameLink: `library://${libraryGameIdString}`,
              lastChecked: new Date(),
              notificationsEnabled: true,
              isActive: true,
            });
            stats.trackedCreated += 1;

            // Without a Steam AppID an imported game can never be checked
            // against SteamDB, so it shows NO APPID and never reports updates.
            if (await verifyLibraryGameOnSteam(created._id, title, cleanedTitle)) {
              stats.trackedVerified += 1;
            }
          }
        }
      } catch (error) {
        stats.errors += 1;
        logger.warn(`Could not import library entry ${filePath}:`, error);
      }
    }

    const removed = await LibraryGame.updateMany(
      { lastSeenAt: { $lt: startedAt }, isActive: true },
      { $set: { isActive: false } },
    );
    stats.gamesRemoved = removed.modifiedCount || 0;

    await LibraryScanJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          filesSeen: stats.filesSeen,
          gamesUpserted: stats.gamesUpserted,
          gamesSkipped: stats.gamesSkipped,
          gamesRemoved: stats.gamesRemoved,
          staleFilesDeleted: stats.staleFilesDeleted,
          staleDeleteErrors: stats.staleDeleteErrors,
          trackedCreated: stats.trackedCreated,
          trackedExisting: stats.trackedExisting,
          trackedExcluded: stats.trackedExcluded,
          trackedVerified: stats.trackedVerified,
          errorCount: stats.errors,
        },
      },
    );
    logger.info(
      `Library scan completed: ${stats.filesSeen} release(s), ${stats.trackedCreated} tracked created ` +
      `(${stats.trackedVerified} Steam-verified), ${stats.trackedExisting} already tracked, ` +
      `${stats.trackedExcluded} excluded, ${stats.staleFilesDeleted} stale archive(s) deleted`,
    );
  } catch (error) {
    await LibraryScanJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'failed',
          completedAt: new Date(),
          filesSeen: stats.filesSeen,
          gamesUpserted: stats.gamesUpserted,
          gamesSkipped: stats.gamesSkipped,
          gamesRemoved: stats.gamesRemoved,
          staleFilesDeleted: stats.staleFilesDeleted,
          staleDeleteErrors: stats.staleDeleteErrors,
          trackedCreated: stats.trackedCreated,
          trackedExisting: stats.trackedExisting,
          trackedExcluded: stats.trackedExcluded,
          trackedVerified: stats.trackedVerified,
          errorCount: stats.errors + 1,
          message: error instanceof Error ? error.message : 'Unknown scan failure',
        },
      },
    );
    throw error;
  }

  return stats;
}
