import fs from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';
import connectDB from './db';
import { LibraryGame, LibraryScanJob, TrackedGame } from './models';
import { getLibraryRoot } from './libraryConfig';
import {
  compareLibraryReleaseInfo,
  normalizeLibraryTitle,
  parseLibraryReleaseInfo,
  type LibraryReleaseInfo,
} from './libraryTitle';
import logger from '../utils/logger';

type ExistingLibraryGame = {
  _id: unknown;
  contentKey?: string;
};

type ExistingTrackedGame = {
  _id: unknown;
  currentVersionNumber?: string;
  currentBuildNumber?: string;
  lastKnownVersion?: string;
  isDateVersion?: boolean;
};

const ARCHIVE_EXTENSIONS = new Set(['.zip']);

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

async function collectRootArchives(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (isLikelyInstallerPart(entry.name)) continue;
    if (!ARCHIVE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(path.join(root, entry.name));
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
    description: `Imported from library zip: ${relativePath}`,
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

export type LibraryScanStats = {
  filesSeen: number;
  gamesUpserted: number;
  gamesSkipped: number;
  gamesRemoved: number;
  trackedCreated: number;
  trackedExisting: number;
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

  const root = getLibraryRoot();
  if (!root) {
    throw new Error('Set LIBRARY_ROOT or GAME_LIBRARY_ROOT to enable NAS library scans.');
  }

  const startedAt = new Date();
  const job = await LibraryScanJob.create({ status: 'running', startedAt });
  const stats: LibraryScanStats = {
    filesSeen: 0,
    gamesUpserted: 0,
    gamesSkipped: 0,
    gamesRemoved: 0,
    trackedCreated: 0,
    trackedExisting: 0,
    errors: 0,
  };

  try {
    await assertLibraryRootReadable(root);
    const files = await collectRootArchives(root);
    stats.filesSeen = files.length;
    logger.info(`Library scan started: ${root} (${files.length} zip file(s))`);

    for (const filePath of files) {
      try {
        const stat = await fs.stat(filePath);
        const fileName = path.basename(filePath);
        const relativePath = path.relative(root, filePath);
        const key = contentKey(stat);
        const existing = await LibraryGame.findOne({ filePath })
          .select('_id contentKey')
          .lean<ExistingLibraryGame | null>();

        let libraryGameId = existing?._id;
        const release = parseLibraryReleaseInfo(fileName);
        const title = release.title;
        const normalizedTitle = normalizeLibraryTitle(title);

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
                extension: path.extname(fileName).toLowerCase(),
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
          }).select('_id currentVersionNumber currentBuildNumber lastKnownVersion isDateVersion').lean<ExistingTrackedGame | null>();

          if (existingTrackedByIdentity) {
            await TrackedGame.updateOne(
              { _id: existingTrackedByIdentity._id },
              {
                $set: {
                  title,
                  originalTitle: title,
                  source: 'Local Library',
                  gameLink: `library://${libraryGameIdString}`,
                  ...buildTrackedReleaseFields(release, stat, relativePath),
                  lastChecked: new Date(),
                  isActive: true,
                },
              },
            );
            stats.trackedExisting += 1;
            continue;
          }

          const existingTrackedByTitle = await TrackedGame.findOne({
            userId,
            isActive: true,
            $or: [
              { title },
              { originalTitle: fileName },
            ],
          }).select('_id currentVersionNumber currentBuildNumber lastKnownVersion isDateVersion').lean<ExistingTrackedGame | null>();

          if (existingTrackedByTitle) {
            if (isCandidateReleaseNewer(existingTrackedByTitle, release)) {
              await TrackedGame.updateOne(
                { _id: existingTrackedByTitle._id },
                {
                  $set: {
                    title,
                    originalTitle: title,
                    source: 'Local Library',
                    gameLink: `library://${libraryGameIdString}`,
                    ...buildTrackedReleaseFields(release, stat, relativePath),
                    lastChecked: new Date(),
                    isActive: true,
                  },
                },
              );
            }
            stats.trackedExisting += 1;
          } else {
            await TrackedGame.create({
              userId,
              gameId,
              title,
              originalTitle: title,
              source: 'Local Library',
              image: '',
              ...buildTrackedReleaseFields(release, stat, relativePath),
              gameLink: `library://${libraryGameIdString}`,
              lastChecked: new Date(),
              notificationsEnabled: true,
              isActive: true,
            });
            stats.trackedCreated += 1;
          }
        }
      } catch {
        stats.errors += 1;
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
          trackedCreated: stats.trackedCreated,
          trackedExisting: stats.trackedExisting,
          errorCount: stats.errors,
        },
      },
    );
    logger.info(
      `Library scan completed: ${stats.filesSeen} zip(s), ${stats.trackedCreated} tracked created, ${stats.trackedExisting} already tracked`,
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
          trackedCreated: stats.trackedCreated,
          trackedExisting: stats.trackedExisting,
          errorCount: stats.errors + 1,
          message: error instanceof Error ? error.message : 'Unknown scan failure',
        },
      },
    );
    throw error;
  }

  return stats;
}
