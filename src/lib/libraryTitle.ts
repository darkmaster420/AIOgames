import path from 'node:path';

const VERSION_PATTERNS = [
  /\bbuild\s*\d+[\w.-]*/gi,
  /\bv?\d+(?:[.\s]\d+)+(?:[a-z]\d*)?(?:[-_. ]?(?:hotfix|patch|update|early access)\d*)?/gi,
  /\b\d{4}[-_.]\d{2}[-_.]\d{2}\b/g,
  /\b(?:incl|update|dlc|bonus|ost|multi\d+|repack|portable|crack|ripped|pre-installed|early access)\b/gi,
  /\b(?:fitgirl|dodi|elamigos|gog|gog-games|steamrip|skidrow|reloaded|flt|codex|rune|tenoke|p2p|0xdeadcode|insaneramzes|goldberg|lws)\b/gi,
];

export function titleFromLibraryFile(fileName: string): string {
  const withoutExt = stripLibraryFilenameNoise(path.basename(fileName, path.extname(fileName)));
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

function stripLibraryFilenameNoise(name: string): string {
  return name
    // Downloader/library export prefix: game-title-(id)-timestamp.zip
    .replace(/^game[-_. ]+(?=.+(?:\(\d+\)|\d{4}[-_.]\d{2}[-_.]\d{2}T))/i, '')
    // Timestamps from downloaded archive names, before separators are normalized.
    .replace(/[-_. ]*\d{4}[-_.]\d{2}[-_.]\d{2}T\d{2}[-_.:]\d{2}[-_.:]\d{2}(?:[-_.]\d+)?Z$/i, '')
    // Numeric source IDs from names like title-(89179).
    .replace(/[-_. ]*\(\d+\)\s*$/g, '')
    // Trailing release groups after a title/version chunk.
    .replace(/[-_. ]+(?:P2P|0xdeadcode|InsaneRamZes|GoldBerg|LWS)$/i, '')
    // Common scene/repack build suffixes before timestamps or release groups.
    .replace(/[-_. ]+(?:Battle\.?NET\.?Rip|Premium\.?Edition|Digital\.?Deluxe\.?Edition)$/i, '');
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
