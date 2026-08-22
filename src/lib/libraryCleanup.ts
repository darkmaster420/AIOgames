import fs from 'node:fs/promises';
import path from 'node:path';
import { isFilePathUnderLibraryRoot } from './libraryConfig';
import {
  ARCHIVE_EXTENSIONS,
  normalizeLibraryTitle,
  parseLibraryReleaseInfo,
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

async function toArchiveCandidate(entry: LibraryFileEntry): Promise<ArchiveCandidate | null> {
  const fileName = path.basename(entry.filePath);
  if (!ARCHIVE_EXTENSION_SET.has(path.extname(fileName).toLowerCase())) return null;
  if (isMultipartArchive(fileName)) return null;

  const stat = await fs.stat(entry.filePath);
  if (!stat.isFile()) return null;

  const release = parseLibraryReleaseInfo(fileName);
  const normalizedTitle = normalizeLibraryTitle(release.title);
  if (!normalizedTitle) return null;

  return {
    ...entry,
    fileName,
    normalizedTitle,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

/**
 * Deletes all but the newest two archive files for each normalized game title.
 * Extracted release directories and multipart archives are deliberately left
 * alone. The feature is disabled unless LIBRARY_STALE_DELETE_ENABLED is true.
 */
export async function cleanupStaleLibraryArchives(
  entries: LibraryFileEntry[],
): Promise<StaleLibraryCleanupResult> {
  if (!isStaleLibraryDeletionEnabled()) {
    return { entries, deleted: 0, errors: 0 };
  }

  const groups = new Map<string, ArchiveCandidate[]>();
  let errors = 0;

  await Promise.all(entries.map(async entry => {
    try {
      const candidate = await toArchiveCandidate(entry);
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
      b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath)
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
