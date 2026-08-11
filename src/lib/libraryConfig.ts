import path from 'node:path';

export function normalizeLibraryRoot(raw: string): string {
  const trimmed = raw.trim();
  if (process.platform === 'win32' && /^[A-Za-z]:$/.test(trimmed)) {
    return `${trimmed}\\`;
  }
  return trimmed;
}

export function getLibraryRoot(): string | null {
  const raw = process.env.LIBRARY_ROOT || process.env.GAME_LIBRARY_ROOT || '';
  const normalized = raw ? normalizeLibraryRoot(raw) : '';
  return normalized || null;
}

export function isFilePathUnderLibraryRoot(filePath: string, libraryRoot: string): boolean {
  const root = path.resolve(libraryRoot);
  const file = path.resolve(filePath);
  if (file === root) return false;
  const rel = path.relative(root, file);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}
