import path from 'node:path';

export type LibraryReleaseInfo = {
  title: string;
  version: string;
  build: string;
  lastKnownVersion: string;
  isDateVersion: boolean;
};

const VERSION_PATTERNS = [
  /\bbuild\s*\d+[\w.-]*/gi,
  /\bv?\d+(?:[.\s]\d+)+(?:[a-z]\d*)?(?:[-_. ]?(?:hotfix|patch|update|early access)\d*)?/gi,
  /\b\d{4}[-_.]\d{2}[-_.]\d{2}\b/g,
  /\b(?:incl|update|dlc|bonus|ost|multi\d+|repack|portable|crack|ripped|pre-installed|early access)\b/gi,
  /\b(?:fitgirl|dodi|elamigos|gog|gog-games|steamrip|skidrow|reloaded|flt|codex|rune|tenoke|p2p|0xdeadcode|insaneramzes|goldberg|lws)\b/gi,
];

export function titleFromLibraryFile(fileName: string): string {
  return parseLibraryReleaseInfo(fileName).title;
}

export function parseLibraryReleaseInfo(fileName: string): LibraryReleaseInfo {
  const baseName = path.basename(fileName, path.extname(fileName));
  const withoutExt = stripLibraryFilenameNoise(baseName);
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

  const title = withoutVersionNoise || cleaned || withoutExt;
  const version = detectLibraryVersion(baseName);
  const build = detectLibraryBuild(baseName);
  const lastKnownVersion = [
    version,
    build ? `Build ${build}` : '',
  ].filter(Boolean).join(' · ');

  return {
    title,
    version,
    build,
    lastKnownVersion,
    isDateVersion: isDateVersion(version),
  };
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

function detectLibraryVersion(name: string): string {
  const patterns = [
    /\bv(\d{4}[-_.]?\d{2}[-_.]?\d{2})\b/i,
    /\bv(\d{8})\b/i,
    /\bv(\d+(?:\.\d+)+(?:[a-z]\d*)?)\b/i,
    /\bversion[-_. ]?(\d+(?:\.\d+)+(?:[a-z]\d*)?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) return match[1].replace(/_/g, '.');
  }

  return '';
}

function detectLibraryBuild(name: string): string {
  const patterns = [
    /\bbuild[-_. ]?(\d{4,})\b/i,
    /\bb(\d{5,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function isDateVersion(version: string): boolean {
  return /^\d{8}$/.test(version) || /^\d{4}[-_.]\d{2}[-_.]\d{2}$/.test(version);
}

export function compareLibraryReleaseInfo(
  current: Pick<LibraryReleaseInfo, 'version' | 'build' | 'isDateVersion'>,
  candidate: Pick<LibraryReleaseInfo, 'version' | 'build' | 'isDateVersion'>,
): number {
  if (current.build && candidate.build) {
    const currentBuild = parseInt(current.build, 10);
    const candidateBuild = parseInt(candidate.build, 10);
    if (Number.isFinite(currentBuild) && Number.isFinite(candidateBuild) && currentBuild !== candidateBuild) {
      return candidateBuild - currentBuild;
    }
  }

  if (current.version && candidate.version) {
    const currentVersion = normalizeComparableVersion(current.version);
    const candidateVersion = normalizeComparableVersion(candidate.version);

    if (current.isDateVersion && candidate.isDateVersion) {
      return candidateVersion.localeCompare(currentVersion);
    }

    const currentParts = currentVersion.split('.').map(parseVersionPart);
    const candidateParts = candidateVersion.split('.').map(parseVersionPart);
    const len = Math.max(currentParts.length, candidateParts.length);
    for (let i = 0; i < len; i++) {
      const currentPart = currentParts[i] || { number: 0, suffix: '' };
      const candidatePart = candidateParts[i] || { number: 0, suffix: '' };
      if (candidatePart.number !== currentPart.number) {
        return candidatePart.number - currentPart.number;
      }
      if (candidatePart.suffix !== currentPart.suffix) {
        return candidatePart.suffix.localeCompare(currentPart.suffix);
      }
    }
  }

  if (!current.version && candidate.version) return 1;
  if (!current.build && candidate.build) return 1;
  return 0;
}

function normalizeComparableVersion(version: string): string {
  return version
    .toLowerCase()
    .replace(/^v/, '')
    .replace(/[-_]/g, '.')
    .trim();
}

function parseVersionPart(part: string): { number: number; suffix: string } {
  const match = part.match(/^(\d+)([a-z]\d*)?$/i);
  if (!match) return { number: 0, suffix: part };
  return {
    number: parseInt(match[1], 10),
    suffix: (match[2] || '').toLowerCase(),
  };
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
