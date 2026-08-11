import fs from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';
import connectDB from './db';
import { LibraryGame, LibraryScanJob } from './models';
import { getLibraryRoot } from './libraryConfig';
import { normalizeLibraryTitle, titleFromLibraryFile } from './libraryTitle';

type ExistingLibraryGame = {
  _id: unknown;
  contentKey?: string;
};

const ARCHIVE_EXTENSIONS = new Set([
  '.zip',
  '.7z',
  '.rar',
  '.iso',
  '.cso',
  '.chd',
  '.rvz',
]);

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

export type LibraryScanStats = {
  filesSeen: number;
  gamesUpserted: number;
  gamesSkipped: number;
  gamesRemoved: number;
  errors: number;
};

let scanInFlight: Promise<LibraryScanStats> | null = null;

export async function runLibraryScan(): Promise<LibraryScanStats> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = runLibraryScanInternal().finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

async function runLibraryScanInternal(): Promise<LibraryScanStats> {
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
    errors: 0,
  };

  try {
    await assertLibraryRootReadable(root);
    const files = await collectRootArchives(root);
    stats.filesSeen = files.length;

    for (const filePath of files) {
      try {
        const stat = await fs.stat(filePath);
        const fileName = path.basename(filePath);
        const relativePath = path.relative(root, filePath);
        const key = contentKey(stat);
        const existing = await LibraryGame.findOne({ filePath })
          .select('_id contentKey')
          .lean<ExistingLibraryGame | null>();

        if (existing?.contentKey === key) {
          await LibraryGame.updateOne(
            { _id: existing._id },
            { $set: { lastSeenAt: new Date(), isActive: true } },
          );
          stats.gamesSkipped += 1;
          continue;
        }

        const title = titleFromLibraryFile(fileName);
        await LibraryGame.updateOne(
          { filePath },
          {
            $set: {
              fileName,
              relativePath,
              title,
              normalizedTitle: normalizeLibraryTitle(title),
              extension: path.extname(fileName).toLowerCase(),
              fileSizeBytes: stat.size,
              mtimeMs: stat.mtimeMs,
              contentKey: key,
              lastSeenAt: new Date(),
              isActive: true,
            },
            $setOnInsert: { filePath },
          },
          { upsert: true },
        );
        stats.gamesUpserted += 1;
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
          errorCount: stats.errors,
        },
      },
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
          errorCount: stats.errors + 1,
          message: error instanceof Error ? error.message : 'Unknown scan failure',
        },
      },
    );
    throw error;
  }

  return stats;
}
