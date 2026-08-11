export type LibraryReleaseInfo = {
  title: string;
  version: string;
  build: string;
  lastKnownVersion: string;
  isDateVersion: boolean;
};

/**
 * Container formats treated as one library entry. Extracted release folders are
 * scanned too (see `libraryScanner`), which is why extensions are matched from
 * this list rather than with `path.extname` — a folder called
 * `Ultimate.Chicken.Horse.v1.13` has an "extension" of `.13`, and stripping it
 * would throw away the version.
 */
export const ARCHIVE_EXTENSIONS = ['.zip', '.iso', '.rar', '.7z'] as const;

const VERSION_PATTERNS = [
  /\bbuild\s*\d+[\w.-]*/gi,
  /\bb\d{2,}\b/gi,
  /\bv?\d+(?:[.\s]\d+)+(?:[a-z]\d*)?(?:[-_. ]?(?:hotfix|patch|update|early access)\d*)?/gi,
  /\bv\d{2,}\b/gi,
  /\b\d{4}[-_.]\d{2}[-_.]\d{2}\b/g,
  /\b(?:incl|update|dlc|bonus|ost|multi\d+|repack|portable|crack|ripped|pre-installed|early access)\b/gi,
  /\b(?:fitgirl|dodi|elamigos|gog|gog-games|steamrip|skidrow|reloaded|flt|codex|rune|tenoke|p2p|0xdeadcode|insaneramzes|goldberg|lws)\b/gi,
];

/** Removes a trailing container extension, leaving folder names untouched. */
export function stripArchiveExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  const ext = ARCHIVE_EXTENSIONS.find(e => lower.endsWith(e));
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

export function titleFromLibraryFile(fileName: string): string {
  return parseLibraryReleaseInfo(fileName).title;
}

export function parseLibraryReleaseInfo(fileName: string): LibraryReleaseInfo {
  const baseName = stripArchiveExtension(fileName);
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
  // Detect from the de-noised name, never the raw one: export timestamps like
  // `-2026-05-18T22-25-49.326Z` contain dotted numbers that would otherwise be
  // picked up as the version.
  const version = detectLibraryVersion(withoutExt);
  const build = detectLibraryBuild(withoutExt);
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

/**
 * Release-group / packager tags that appear as a `<group>-` prefix on the
 * filename (e.g. `rune-carx.street.v1.14.0.iso`, `voices38-stellar.blade.iso`).
 * Matched as an explicit list rather than a generic `^\w+-` rule, which would
 * eat the first word of legitimate titles like `Five-Nights-at-Freddys-2`.
 */
const LEADING_RELEASE_GROUPS = [
  '0xdeadcode', 'codex', 'dodi', 'elamigos', 'fitgirl', 'flt', 'goldberg',
  'insaneramzes', 'lws', 'p2p', 'reloaded', 'rune', 'skidrow', 'steamrip',
  'tenoke', 'voices38',
];

const LEADING_RELEASE_GROUP_RE = new RegExp(
  `^(?:${LEADING_RELEASE_GROUPS.join('|')})[-_. ]+`,
  'i',
);

function stripLibraryFilenameNoise(name: string): string {
  return name
    // Downloader/library export prefix: game-title-(id)-timestamp.zip
    .replace(/^game[-_. ]+(?=.+(?:\(\d+\)|\d{4}[-_.]\d{2}[-_.]\d{2}T))/i, '')
    // Packager prefix: rune-carx.street..., voices38-stellar.blade...
    .replace(LEADING_RELEASE_GROUP_RE, '')
    // Timestamps from downloaded archive names, before separators are normalized.
    .replace(/[-_. ]*\d{4}[-_.]\d{2}[-_.]\d{2}T\d{2}[-_.:]\d{2}[-_.:]\d{2}(?:[-_.]\d+)?Z$/i, '')
    // Numeric source IDs from names like title-(89179).
    .replace(/[-_. ]*\(\d+\)\s*$/g, '')
    // Site watermarks: `The-Walking-Trade-SteamRIP.com`, `..._CSF`.
    .replace(/[-_. ]*(?:steamrip|gog-games|elamigos|ovagames)?\.?com\s*$/i, '')
    .replace(/_(?:CSF|CSP)\s*$/i, '')
    // Trailing release groups after a title/version chunk. `-P2` shows up on
    // truncated directory names (Outbound.v1.1.7.969-P2).
    .replace(/[-_. ]+(?:P2P|P2|0xdeadcode|InsaneRamZes|GoldBerg|LWS)$/i, '')
    // Common scene/repack build suffixes before timestamps or release groups.
    .replace(/[-_. ]+(?:Battle\.?NET\.?Rip|Premium\.?Edition|Digital\.?Deluxe\.?Edition)$/i, '');
}

/**
 * Bare `v<digits>` with no dots, e.g. `Screamer.v1774914`, `Far.Far.West.v644`.
 * Long runs are Steam build ids rather than versions, so they're reported as
 * builds — see `detectLibraryBuild`. Requires 2+ digits so a stray `V2` token
 * in a title is less likely to be read as a version.
 */
const BARE_V_NUMBER = /\bv(\d{2,})\b/i;
/** At/above this many digits a bare number is a build id, not a version. */
const BUILD_ID_DIGITS = 5;

function detectLibraryVersion(name: string): string {
  const patterns = [
    // Date-style versions first: v20260616 must not be read as a build id.
    /\bv(\d{4}[-_.]\d{2}[-_.]\d{2})\b/i,
    /\bv(\d{8})\b/i,
    /\bv(\d+(?:\.\d+)+(?:[a-z]\d*)?)\b/i,
    /\bversion[-_. ]?(\d+(?:\.\d+)+(?:[a-z]\d*)?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) return match[1].replace(/_/g, '.');
  }

  const bare = name.match(BARE_V_NUMBER);
  if (bare?.[1] && bare[1].length < BUILD_ID_DIGITS) {
    return bare[1];
  }

  // Last resort: a dotted number with no `v` prefix. Runs only after every
  // prefixed form has failed, so `F1.2024.v1.5` still resolves to 1.5 — this
  // exists purely so `Elden.Ring.1.12.3` stops discarding its version.
  const unprefixed = name.match(/\b(\d+(?:\.\d+)+(?:[a-z]\d*)?)\b/i);
  if (unprefixed?.[1]) return unprefixed[1].replace(/_/g, '.');

  return '';
}

function detectLibraryBuild(name: string): string {
  const patterns = [
    /\bbuild[-_. ]?(\d{4,})\b/i,
    // Short build tags such as `7.Days.To.Die.v2.6.B14`.
    /\bb(\d{2,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) return match[1];
  }

  // `v808996` — labelled as a version but really a Steam build id.
  const bare = name.match(BARE_V_NUMBER);
  if (bare?.[1] && bare[1].length >= BUILD_ID_DIGITS && !isDateVersion(bare[1])) {
    return bare[1];
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
