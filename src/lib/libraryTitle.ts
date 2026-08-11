import path from 'node:path';

const VERSION_PATTERNS = [
  /\bbuild\s*\d+[\w.-]*/gi,
  /\bv?\d+\.\d+(?:\.\d+)*(?:[-_. ]?(?:hotfix|patch|update)\d*)?/gi,
  /\b\d{4}[-_.]\d{2}[-_.]\d{2}\b/g,
  /\b(?:incl|update|dlc|bonus|ost|multi\d+|repack|portable|crack|ripped|pre-installed)\b/gi,
  /\b(?:fitgirl|dodi|elamigos|gog|gog-games|steamrip|skidrow|reloaded|flt|codex|rune|tenoke)\b/gi,
];

export function titleFromLibraryFile(fileName: string): string {
  const withoutExt = path.basename(fileName, path.extname(fileName));
  const cleaned = withoutExt
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const withoutVersionNoise = VERSION_PATTERNS.reduce(
    (title, pattern) => title.replace(pattern, ' '),
    cleaned,
  )
    .replace(/\s+/g, ' ')
    .trim();

  return withoutVersionNoise || cleaned || withoutExt;
}

export function normalizeLibraryTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|edition|deluxe|ultimate|complete|definitive|remastered|remaster)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
