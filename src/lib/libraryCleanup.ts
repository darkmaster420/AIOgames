import fs from 'node:fs/promises';
import path from 'node:path';
import { isFilePathUnderLibraryRoot } from './libraryConfig';
import {
  ARCHIVE_EXTENSIONS,
  compareLibraryReleaseInfo,
  normalizeLibraryTitle,
  parseLibraryReleaseInfo,
  type LibraryReleaseInfo,
} from './libraryTitle';
import logger from '../utils/logger';

export type LibraryFileEntry = {
  filePath: string;
  sourceRoot: string;
};

export type StaleLibraryCleanupResult = {
  entries: LibraryFileEntry[];
  deleted: number;
  errors: number;
};

type ArchiveCandidate = LibraryFileEntry & {
  fileName: string;
  normalizedTitle: string;
  release: LibraryReleaseInfo;
  mtimeMs: number;
  size: number;
};

const STALE_LIBRARY_KEEP_COUNT = 2;
const ARCHIVE_EXTENSION_SET = new Set<string>(ARCHIVE_EXTENSIONS);

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function isStaleLibraryDeletionEnabled(): boolean {
  return envFlag('LIBRARY_STALE_DELETE_ENABLED');
}

function isMultipartArchive(fileName: string): boolean {
  return /\.part\d+\.(?:rar|7z|zip)$/i.test(fileName);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when other volumes of the same set sit beside this file.
 *
 * The classic scene layout is `Game.rar` + `Game.r00` + `Game.r01`: only the
 * `.rar` is collected as an archive (the `.rNN` parts are filtered out earlier
 * as installer parts), so on its own it looks like a standalone download and
 * deleting it would silently orphan the rest of the set. `.7z.001` style
 * volumes are checked the same way.
 */
function hasSiblingVolumes(siblings: Set<string>, fileName: string): boolean {
  const base = escapeRegExp(fileName.replace(/\.[^.]+$/, ''));
  const full = escapeRegExp(fileName);
  const patterns = [
    new RegExp(`^${base}\\.r\\d{2,3}$`, 'i'),
    new RegExp(`^${base}\\.\\d{3}$`, 'i'),
    new RegExp(`^${full}\\.\\d{3}$`, 'i'),
    new RegExp(`^${base}\\.part\\d+\\.(?:rar|7z|zip)$`, 'i'),
  ];

  for (const sibling of siblings) {
    if (sibling === fileName) continue;
    if (patterns.some(pattern => pattern.test(sibling))) return true;
  }
  return false;
}

/** Directory listings are shared across candidates so each dir is read once. */
async function listDirectory(cache: Map<string, Set<string>>, dir: string): Promise<Set<string>> {
  const cached = cache.get(dir);
  if (cached) return cached;
  const names = new Set(await fs.readdir(dir));
  cache.set(dir, names);
  return names;
}

async function toArchiveCandidate(
  entry: LibraryFileEntry,
  dirCache: Map<string, Set<string>>,
): Promise<ArchiveCandidate | null> {
  const fileName = path.basename(entry.filePath);
  if (!ARCHIVE_EXTENSION_SET.has(path.extname(fileName).toLowerCase())) return null;
  if (isMultipartArchive(fileName)) return null;

  const siblings = await listDirectory(dirCache, path.dirname(entry.filePath));
  if (hasSiblingVolumes(siblings, fileName)) return null;

  const stat = await fs.stat(entry.filePath);
  if (!stat.isFile()) return null;

  const release = parseLibraryReleaseInfo(fileName);
  const normalizedTitle = normalizeLibraryTitle(release.title);
  if (!normalizedTitle) return null;

  return {
    ...entry,
    fileName,
    normalizedTitle,
    release,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

/**
 * Orders two releases newest-first by version/build.
 *
 * `compareLibraryReleaseInfo` is not antisymmetric — it answers "is the
 * candidate newer than the current one", and returns 0 rather than a negative
 * when only the first side carries a version. Asking it both ways turns that
 * into a comparator that is safe to sort with, and yields 0 only when the two
 * are genuinely indistinguishable.
 */
function compareReleaseNewestFirst(a: ArchiveCandidate, b: ArchiveCandidate): number {
  const bIsNewer = compareLibraryReleaseInfo(a.release, b.release);
  const aIsNewer = compareLibraryReleaseInfo(b.release, a.release);
  if (bIsNewer > 0 && aIsNewer <= 0) return 1;
  if (aIsNewer > 0 && bIsNewer <= 0) return -1;
  return 0;
}

/**
 * Deletes all but the newest two archive files for each normalized game title.
 * Extracted release directories and multipart archives are deliberately left
 * alone. The feature is disabled unless LIBRARY_STALE_DELETE_ENABLED is true.
 *
 * Retention is decided by the version and build parsed from the filename, and
 * only falls back to modification time when neither release carries either.
 * mtime alone is not a release ordering: copying, rsync without -t, or
 * re-downloading an older build all rewrite it, which would let an old release
 * evict the newest one.
 */
export async function cleanupStaleLibraryArchives(
  entries: LibraryFileEntry[],
): Promise<StaleLibraryCleanupResult> {
  if (!isStaleLibraryDeletionEnabled()) {
    return { entries, deleted: 0, errors: 0 };
  }

  const groups = new Map<string, ArchiveCandidate[]>();
  const dirCache = new Map<string, Set<string>>();
  let errors = 0;

  await Promise.all(entries.map(async entry => {
    try {
      const candidate = await toArchiveCandidate(entry, dirCache);
      if (!candidate) return;
      const group = groups.get(candidate.normalizedTitle) || [];
      group.push(candidate);
      groups.set(candidate.normalizedTitle, group);
    } catch (error) {
      errors += 1;
      logger.warn(`Could not inspect library archive for stale cleanup: ${entry.filePath}`, error);
    }
  }));

  const deletedPaths = new Set<string>();

  for (const [normalizedTitle, candidates] of groups) {
    if (candidates.length <= STALE_LIBRARY_KEEP_COUNT) continue;

    candidates.sort((a, b) =>
      compareReleaseNewestFirst(a, b)
      || b.mtimeMs - a.mtimeMs
      || b.filePath.localeCompare(a.filePath)
    );

    for (const candidate of candidates.slice(STALE_LIBRARY_KEEP_COUNT)) {
      try {
        if (!isFilePathUnderLibraryRoot(candidate.filePath, candidate.sourceRoot)) {
          throw new Error('Resolved archive path is outside its configured library root');
        }

        // Do not remove a download that changed after candidates were ranked.
        const current = await fs.stat(candidate.filePath);
        if (!current.isFile() || current.mtimeMs !== candidate.mtimeMs || current.size !== candidate.size) {
          throw new Error('Archive changed during the scan');
        }

        await fs.unlink(candidate.filePath);
        deletedPaths.add(candidate.filePath);
        logger.info(
          `Deleted stale library archive for "${normalizedTitle}": ${candidate.fileName}`,
        );
      } catch (error) {
        errors += 1;
        logger.warn(`Could not delete stale library archive: ${candidate.filePath}`, error);
      }
    }
  }

  return {
    entries: entries.filter(entry => !deletedPaths.has(entry.filePath)),
    deleted: deletedPaths.size,
    errors,
  };
}
