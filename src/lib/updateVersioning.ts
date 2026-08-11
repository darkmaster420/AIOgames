/**
 * Shared release-version detection for the update-check routes.
 *
 * `/api/updates/check` (bulk, scheduler-driven) and `/api/updates/check-single`
 * (one game, user-driven) each carried their own copy of this logic. The copies
 * had drifted: the bulk route grew release-hierarchy rules, PROPER handling and
 * date-version deferral that the single-game route never received, so checking
 * one game could approve an update the bulk pass would reject. This module is
 * the bulk route's implementation - the more complete of the two - now used by
 * both so their verdicts agree.
 */

import { getPostDetails } from './gameapi';
import { cleanGameTitle, resolveComparableVersionData } from '../utils/steamApi';
import logger from '../utils/logger';

export interface GameSearchResult {
  id: string;
  title: string;
  link: string;
  date?: string;
  image?: string | null;
  description?: string;
  source: string;
  downloadLinks?: Array<{
    service: string;
    url: string;
    type: string;
  }>;
}

export interface VersionInfo {
  version: string;
  build: string;
  releaseType: string;
  updateType: string;
  baseTitle: string;
  fullVersionString: string;
  confidence: number;
  needsUserConfirmation: boolean;
  isDateVersion: boolean;
  versionDate?: Date;
  hasRegularVersion: boolean;
}

export interface EnhancedMatch {
  game: GameSearchResult;
  similarity: number;
  versionInfo: VersionInfo;
  gate: string;
  enhancedScore?: number;
}

export type VersionComparison = {
  isNewer: boolean;
  changeType: string;
  significance: number;
  shouldWaitForRegular?: boolean;
  suspiciousVersion?: { isSuspicious: boolean; reason?: string };
  skipDueToHierarchy?: boolean;
};

export async function fetchDownloadLinks(game: GameSearchResult): Promise<Array<{ service: string; url: string; type: string }>> {
  try {
    // Extract the original ID and site type from the composite ID
    // Format: "siteType_originalId" (e.g., "skidrow_518912")
    const [siteType, originalId] = game.id.split('_');
    
    if (!siteType || !originalId) {
      logger.warn(`Invalid game ID format: ${game.id}`);
      return [];
    }

    if (siteType === 'dodi') {
      return [];
    }
    
    logger.debug(`Fetching download links for: ${siteType}/${originalId}`);
    
    const data = await getPostDetails(originalId, siteType);
    
    if (data.success && data.post && data.post.downloadLinks) {
      logger.info(`Fetched ${data.post.downloadLinks.length} download links for ${game.title}`);
      return data.post.downloadLinks;
    }
    
    return [];
  } catch (error) {
    logger.error(`Error fetching download links for ${game.title}:`, error);
    return [];
  }
}

export function extractVersionInfo(title: string): VersionInfo {
  const originalTitle = title;
  const cleanTitle = cleanGameTitle(title);
  
  // Extract version patterns - comprehensive coverage for piracy releases with alpha/beta/letter suffix support
  const versionPatterns = [
    /v(\d+\.\d+\.\d+\.\d+(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,   // v1.2.3.4a, v1.2.3.4f12, v1.2.3.4.a, v1.2.3.4-alpha
    /v(\d{4}[-.]?\d{2}[-.]?\d{2}(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,  // v2024-01-15a, v20240115f12, v20240115-beta
    /v(\d{2}\.\d{2}\.\d{2}\b(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i, // v30.09.25 (DD.MM.YY format)
    /v(\d{8}(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,                // v20240115a, v20240115f12, v20240115.a
    /v(\d+(?:\.\d+)+(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,        // v1.2.3a, v1.2.3f12, v0.4.4f12, v1.2.3.a, v1.2.3-beta
    /version\s*(\d+(?:\.\d+)+(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i, // version 1.2.3a, version 1.2.3f12, version 1.2.3.a
    /ver\.?\s*(\d+(?:\.\d+)+(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,  // ver 1.2a, ver 1.2f12, ver. 1.2.a, ver. 1.2-alpha
    /(\d+\.\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/,     // 1.2.3a, 1.2.3f12, 1.2.3.a (standalone)
    /\[(\d+\.\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)\]/i, // [1.2.3a], [1.2.3f12], [1.2.3.a] (bracketed)
    /\-(\d+\.\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)\-/i, // -1.2.3a-, -1.2.3f12-, -1.2.3.a- (dashed)
    /update\s*(\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,  // update 1.5a, update 1.5f12
    /patch\s*(\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,   // patch 1.2a, patch 1.2f12
    /hotfix\s*(\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,  // hotfix 1.1a, hotfix 1.1f12
    /rev\s*(\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,     // rev 2.1a, rev 2.1f12
    /r(\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i           // r1.5a, r1.5f12
  ];
  
  // Extract build patterns - enhanced for scene releases
  const buildPatterns = [
    /build\s*#?(\d+)/i,     // build 12345, build #12345
    /b(\d{4,})/i,           // b12345
    /#(\d{4,})/i,           // #12345
    /rev\s*(\d+)/i,         // rev 123, revision 123
    /r(\d{3,})/i,           // r123
    /release\s*(\d+)/i,     // release 1
    /\.(\d{8})\./i,         // .20240115. (date builds)
    /\-(\d{6,})\-/i,        // -123456- (build in dashes)
    /\[(\d{5,})\]/i          // [12345] (bracketed builds)
  ];
  
  const releaseTypes = [
    // Quality/Edition indicators
    'REPACK', 'PROPER', 'REAL PROPER', 'UNCUT', 'EXTENDED', 'DIRECTORS CUT', 'COMPLETE', 'GOTY', 'DEFINITIVE', 'ENHANCED',
    'DELUXE', 'ULTIMATE', 'PREMIUM', 'COLLECTORS', 'SPECIAL EDITION', 'LIMITED EDITION', 'ANNIVERSARY',
    
    // Scene release indicators
    'CRACKED', 'DENUVOLESS', 'DRM FREE', 'UNLOCKED', 'ACTIVATED', 'FULL UNLOCKED',
    
    // Content indicators
    'ALL DLC', 'COMPLETE PACK', 'SEASON PASS', 'GOLD EDITION', 'GAME OF THE YEAR',
    
    // Technical indicators
    'MULTI LANG', 'ENGLISH', 'MULTILANGUAGE', 'RUS ENG', 'MULTI13', 'MULTI12',
    'STEAM RIP', 'GOG RIP', 'EPIC RIP', 'ORIGIN RIP',
    
    // Format indicators
    'PORTABLE', 'STANDALONE', 'PREINSTALLED', 'PRE INSTALLED', 'READY TO PLAY'
  ];
  
  const updateTypes = [
    'UPDATE', 'HOTFIX', 'PATCH', 'DLC', 'EXPANSION', 
    'BUGFIX', 'CRITICAL UPDATE', 'SECURITY UPDATE', 'CONTENT UPDATE',
    'DAY ONE PATCH', 'POST LAUNCH', 'ANNIVERSARY UPDATE'
  ];
  
  let version = '';
  let build = '';
  let releaseType = '';
  let updateType = '';
  let confidence = 1.0;
  
  // Detect scene groups for confidence adjustment
  const sceneGroups = [
    'CODEX', 'PLAZA', 'SKIDROW', 'EMPRESS', 'FITGIRL', 'DODI', 'RUNE', 'TENOKE', 'CPY',
    'ALI213', '3DM', 'RELOADED', 'RAZOR1911', 'PROPHET', 'HOODLUM', 'FAIRLIGHT',
    'SIMPLEX', 'DARKZER0', 'CHRONOS', 'FLT', 'UNLEASHED', 'DEVIANCE', 'VITALITY',
    'OUTLAWS', 'TINYISO', 'STEAMPUNKS', 'DARKSIDERS', 'MASQUERADE', 'GOLDBERG', 'OVA GAMES'
  ];
  
  const hasSceneGroup = sceneGroups.some(group => 
    originalTitle.toUpperCase().includes(group) || originalTitle.toUpperCase().includes(`-${group}`)
  );
  
  if (hasSceneGroup) {
    confidence *= 0.95; // High confidence for known scene groups
  }

  // Extract version number
  for (const pattern of versionPatterns) {
    const match = originalTitle.match(pattern);
    if (match) {
      version = match[1];
      confidence *= 0.9;
      break;
    }
  }
  
  if (!version) {
    for (const pattern of versionPatterns) {
      const match = cleanTitle.match(pattern);
      if (match) {
        version = match[1];
        confidence *= 0.8;
        break;
      }
    }
  }
  
  // Extract build number
  for (const pattern of buildPatterns) {
    const match = originalTitle.match(pattern);
    if (match) {
      build = match[1];
      confidence *= 0.85;
      break;
    }
  }
  
  // Extract types
  for (const type of releaseTypes) {
    if (cleanTitle.includes(type)) {
      releaseType = type;
      confidence *= 0.95;
      break;
    }
  }
  
  for (const type of updateTypes) {
    if (cleanTitle.includes(type)) {
      updateType = type;
      confidence *= 0.9;
      break;
    }
  }
  
  // Additional confidence adjustments for piracy releases
  const piracyIndicators = ['cracked', 'repack', 'denuvoless', 'drm free', 'pre installed'];
  const hasPiracyIndicators = piracyIndicators.some(indicator => 
    originalTitle.toLowerCase().includes(indicator)
  );
  
  if (hasPiracyIndicators) {
    confidence *= 0.9; // Still high confidence but slightly lower
  }
  
  // Boost confidence if we have clear version and/or build info
  if (version && build) {
    confidence *= 1.1; // Both version and build found
  } else if (version || build) {
    confidence *= 1.05; // At least one found
  }
  
  // Detect if this is a date-based version
  const isDateVersion = /v?\d{4}[-.]?\d{2}[-.]?\d{2}|v?\d{8}/.test(version);
  let versionDate: Date | undefined;
  let hasRegularVersion = false;
  
  if (isDateVersion && version) {
    // Extract date from version string (YYYY-MM-DD or YYYYMMDD format)
    const dateMatch = version.match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
    if (dateMatch) {
      const year = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10) - 1; // JavaScript months are 0-indexed
      const day = parseInt(dateMatch[3], 10);
      versionDate = new Date(year, month, day);
    }
  } else if (version) {
    // Check for DD.MM.YY date format (like v30.09.25)
    const ddmmyyMatch = version.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (ddmmyyMatch) {
      const day = parseInt(ddmmyyMatch[1], 10);
      const month = parseInt(ddmmyyMatch[2], 10);
      // Valid date check: day 1-31, month 1-12
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        let year = parseInt(ddmmyyMatch[3], 10);
        year += year < 50 ? 2000 : 1900; // assume 2000+ for 00-49, 1900+ for 50-99
        versionDate = new Date(year, month - 1, day); // JavaScript months are 0-indexed
        // Mark as date version even though it doesn't match the other patterns
        hasRegularVersion = false;
      } else {
        // Not a valid date, treat as regular version
        hasRegularVersion = true;
      }
    } else if (/^\d+\.\d+/.test(version)) {
      hasRegularVersion = true;
    }
  }
  
  return {
    version,
    build,
    releaseType,
    updateType,
    baseTitle: cleanTitle,
    fullVersionString: `${version}${build ? ` Build ${build}` : ''}${releaseType ? ` ${releaseType}` : ''}`,
    confidence: Math.min(confidence, 1.0), // Cap at 1.0
    needsUserConfirmation: confidence < 0.7,
    isDateVersion: isDateVersion || !!versionDate,
    versionDate,
    hasRegularVersion
  };
}

/**
 * Detect suspicious version patterns that might indicate invalid versioning
 * Examples: v6.6.0.0 when expecting v6.06, or excessive version jumps
 */

export function detectSuspiciousVersion(oldVersion: string, newVersion: string): { isSuspicious: boolean; reason?: string } {
  // Check for excessive parts (e.g., v6.6.0.0 has 4 parts when v6.06 has 2)
  const oldParts = oldVersion.split('.').filter(p => p.length > 0);
  const newParts = newVersion.split('.').filter(p => p.length > 0);
  
  // Suspicious if new version has significantly more parts than old version
  if (newParts.length > oldParts.length + 1) {
    return {
      isSuspicious: true,
      reason: `Version structure changed significantly (${oldParts.length} parts → ${newParts.length} parts)`
    };
  }
  
  // Check for invalid patterns like v6.6.0.0 vs v6.06
  // If old version uses zero-padding (like 06) but new version doesn't (like 6)
  const hasZeroPadding = (str: string) => str.split('.').some(p => p.startsWith('0') && p.length > 1);
  const oldHasPadding = hasZeroPadding(oldVersion);
  const newHasPadding = hasZeroPadding(newVersion);
  
  if (oldHasPadding !== newHasPadding) {
    return {
      isSuspicious: true,
      reason: `Version format inconsistency (padding changed: ${oldVersion} → ${newVersion})`
    };
  }
  
  // Check for excessive version jumps (e.g., v1.2 to v1.5 might be suspicious depending on game)
  const oldFirstTwo = oldParts.slice(0, 2).map(Number);
  const newFirstTwo = newParts.slice(0, 2).map(Number);
  
  // Major version jump (e.g., v1.x to v3.x or higher)
  if (!isNaN(oldFirstTwo[0]) && !isNaN(newFirstTwo[0])) {
    const majorJump = newFirstTwo[0] - oldFirstTwo[0];
    if (majorJump > 2) {
      return {
        isSuspicious: true,
        reason: `Large major version jump (${oldFirstTwo[0]} → ${newFirstTwo[0]})`
      };
    }
  }
  
  // Minor version jump within same major version (e.g., v6.06 to v6.60)
  if (!isNaN(oldFirstTwo[0]) && !isNaN(newFirstTwo[0]) && 
      !isNaN(oldFirstTwo[1]) && !isNaN(newFirstTwo[1]) &&
      oldFirstTwo[0] === newFirstTwo[0]) {
    const minorJump = newFirstTwo[1] - oldFirstTwo[1];
    // Suspicious if minor version jumps by more than 20 (e.g., 6.06 to 6.60 is suspicious)
    if (minorJump > 20) {
      return {
        isSuspicious: true,
        reason: `Large minor version jump (${oldVersion} → ${newVersion})`
      };
    }
  }
  
  return { isSuspicious: false };
}

// Proper semantic version comparison: returns 1 if a > b, -1 if a < b, 0 if equal

export function compareSemanticVersions(a: string, b: string): number {
  const aParts = parseComparableVersionParts(a);
  const bParts = parseComparableVersionParts(b);
  const maxLength = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i] || { number: 0, suffix: '' };
    const bPart = bParts[i] || { number: 0, suffix: '' };

    if (aPart.number > bPart.number) return 1;
    if (aPart.number < bPart.number) return -1;

    const suffixCmp = compareVersionSuffix(aPart.suffix, bPart.suffix);
    if (suffixCmp !== 0) return suffixCmp;
  }
  return 0;
}

/**
 * Returns true when two records identify the same downloadable release.
 * Build IDs are authoritative when both sides have one; otherwise semantic
 * versions are compared so formatting differences such as v1.2 and 1.2.0 do
 * not turn a repost into an update.
 */
export function isSameReleaseVersion(current: VersionInfo, candidate: VersionInfo): boolean {
  const currentBuild = String(current.build || '').trim();
  const candidateBuild = String(candidate.build || '').trim();
  if (currentBuild && candidateBuild) {
    return currentBuild === candidateBuild;
  }

  const currentVersion = String(current.version || '').trim();
  const candidateVersion = String(candidate.version || '').trim();
  if (!currentVersion || !candidateVersion) return false;

  const normalize = (value: string) => {
    const normalized = value.toLowerCase().replace(/^v\s*/i, '').trim();
    return /^\d{4}[-.]?\d{2}[-.]?\d{2}$/.test(normalized)
      ? normalized.replace(/[-.]/g, '')
      : normalized;
  };

  return normalize(currentVersion) === normalize(candidateVersion) ||
    compareSemanticVersions(currentVersion, candidateVersion) === 0;
}

function parseComparableVersionParts(version: string): Array<{ number: number; suffix: string }> {
  return String(version || '')
    .trim()
    .replace(/^v\s*/i, '')
    .split('.')
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase().trim();
      const match = normalized.match(/^(\d+)(?:[-_]?([a-z][a-z0-9-]*))?$/i);

      if (match) {
        return {
          number: parseInt(match[1], 10),
          suffix: (match[2] || '').toLowerCase(),
        };
      }

      const numericPrefix = normalized.match(/^(\d+)/);
      if (numericPrefix) {
        return {
          number: parseInt(numericPrefix[1], 10),
          suffix: normalized.slice(numericPrefix[1].length).replace(/^[-_]+/, ''),
        };
      }

      return { number: 0, suffix: normalized };
    });
}

function suffixWeight(suffix: string): number {
  const normalized = (suffix || '').toLowerCase();
  if (!normalized) return 100;
  if (normalized.startsWith('final') || normalized.startsWith('release')) return 95;
  if (normalized.startsWith('rc')) return 85;
  if (normalized.startsWith('beta')) return 75;
  if (normalized.startsWith('alpha') || normalized.startsWith('pre') || normalized.startsWith('preview')) return 65;
  // Letter-only ('f') or letter+digits ('f12') mean sequential post-release patches.
  // v0.4.3 < v0.4.3a < v0.4.3f < v0.4.3f1 < v0.4.3f12 < v0.4.3g
  // Weight above the base release (100) so any suffix is seen as newer than no suffix.
  const letterDigitMatch = normalized.match(/^([a-z])(\d*)$/);
  if (letterDigitMatch) {
    const letterOffset = letterDigitMatch[1].charCodeAt(0) - 97;
    const num = parseInt(letterDigitMatch[2] || '0', 10);
    return 101 + letterOffset * 1000 + num;
  }
  return 70;
}

function compareVersionSuffix(aSuffix: string, bSuffix: string): number {
  const aWeight = suffixWeight(aSuffix);
  const bWeight = suffixWeight(bSuffix);

  if (aWeight > bWeight) return 1;
  if (aWeight < bWeight) return -1;

  if (aSuffix > bSuffix) return 1;
  if (aSuffix < bSuffix) return -1;
  return 0;
}

export type VersionScheme = 'semver' | 'build' | 'date' | 'unknown';

export function detectVersionScheme(info: VersionInfo): VersionScheme {
  const normalizedVersion = String(info.version || '').trim().replace(/^v\s*/i, '');

  if (info.isDateVersion || /^\d{8}$/.test(normalizedVersion) || /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(normalizedVersion)) {
    return 'date';
  }

  if (/^\d+\.\d+(?:\.\d+){0,2}(?:[-_.]?(?:[a-z][a-z0-9-]*))?$/i.test(normalizedVersion)) {
    return 'semver';
  }

  if (info.build && /^\d+$/.test(String(info.build).trim())) {
    return 'build';
  }

  return 'unknown';
}

export function parsePubTimestamp(value?: string | Date | number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  return 0;
}


export function compareVersions(oldVersion: VersionInfo, newVersion: VersionInfo): { isNewer: boolean; changeType: string; significance: number; shouldWaitForRegular?: boolean; suspiciousVersion?: { isSuspicious: boolean; reason?: string }; skipDueToHierarchy?: boolean } {
  let isNewer = false;
  let changeType = 'unknown';
  let significance = 0;
  let shouldWaitForRegular = false;
  let skipDueToHierarchy = false;
  
  // **RELEASE PRIORITY HIERARCHY**
  // 1. Versioned releases (v1.0, v1.1) = HIGHEST PRIORITY - always accept
  // 2. PROPER releases = MEDIUM PRIORITY - only accept if no version
  // 3. First releases (no version/PROPER) = LOWEST PRIORITY - accept initially, replaced by above
  
  const oldIsVersioned = !!(oldVersion.version && !oldVersion.isDateVersion);
  const newIsVersioned = !!(newVersion.version && !newVersion.isDateVersion);
  const oldIsProper = oldVersion.releaseType?.toUpperCase().includes('PROPER') || false;
  const newIsProper = newVersion.releaseType?.toUpperCase().includes('PROPER') || false;
  
  // Rule 1: If OLD has versioned release, NEW must also be versioned AND higher
  if (oldIsVersioned && !newIsVersioned) {
    // Reject: Can't downgrade from versioned to non-versioned (even PROPER)
    skipDueToHierarchy = true;
    changeType = 'rejected_hierarchy';
    significance = 0;
    logger.info(`❌ Skipping non-versioned release (current has version: ${oldVersion.version})`);
    return { isNewer: false, changeType, significance, shouldWaitForRegular, skipDueToHierarchy };
  }
  
  // Rule 2: If OLD is PROPER (but not versioned) and NEW is non-versioned non-PROPER, reject
  if (oldIsProper && !oldIsVersioned && !newIsVersioned && !newIsProper) {
    skipDueToHierarchy = true;
    changeType = 'rejected_hierarchy_proper';
    significance = 0;
    logger.info(`❌ Skipping regular release (current is PROPER without version clash)`);
    return { isNewer: false, changeType, significance, shouldWaitForRegular, skipDueToHierarchy };
  }
  
  // Rule 3: If OLD is first release (no version, no PROPER) and NEW is PROPER or versioned, accept
  if (!oldIsVersioned && !oldIsProper && (newIsProper || newIsVersioned)) {
    isNewer = true;
    changeType = newIsVersioned ? 'upgrade_to_versioned' : 'upgrade_to_proper';
    significance = newIsVersioned ? 10 : 7; // Versioned = highest priority
    logger.info(`✅ Upgrading from first release to ${newIsVersioned ? 'versioned' : 'PROPER'} release`);
    return { isNewer, changeType, significance, shouldWaitForRegular, skipDueToHierarchy };
  }
  
  // Rule 4: If OLD is PROPER and NEW is versioned, always accept (versioned > PROPER)
  if (oldIsProper && !oldIsVersioned && newIsVersioned) {
    isNewer = true;
    changeType = 'proper_to_versioned';
    significance = 10;
    logger.info(`✅ Upgrading from PROPER to versioned release`);
    return { isNewer, changeType, significance, shouldWaitForRegular, skipDueToHierarchy };
  }
  
  // Smart version preference logic:
  // 1. Regular versions (1.2.3) always preferred over date versions (v20241011)
  // 2. If new version is date-based and recent (< 2 days), suggest waiting for regular version
  // 3. Date versions should be compared by actual dates, not as version numbers
  
  const oldIsDate = oldVersion.isDateVersion;
  const newIsDate = newVersion.isDateVersion;
  const oldHasRegular = oldVersion.hasRegularVersion;
  const newHasRegular = newVersion.hasRegularVersion;
  
  // Case 1: Old has regular version, new is date-based -> prefer waiting for regular
  if (oldHasRegular && newIsDate && !newHasRegular) {
    // Check if the date version is very recent (< 2 days)
    if (newVersion.versionDate) {
      const daysSinceNewVersion = Math.floor((Date.now() - newVersion.versionDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceNewVersion < 2) {
        shouldWaitForRegular = true;
        changeType = 'date_version_recent';
        significance = 1; // Low significance
        isNewer = false; // Don't treat as newer yet
        return { isNewer, changeType, significance, shouldWaitForRegular, skipDueToHierarchy };
      }
    }
  }
  
  // Case 2: Both are date-based -> compare by actual dates
  if (oldIsDate && newIsDate && oldVersion.versionDate && newVersion.versionDate) {
    if (newVersion.versionDate > oldVersion.versionDate) {
      isNewer = true;
      changeType = 'date_update';
      const daysDiff = Math.floor((newVersion.versionDate.getTime() - oldVersion.versionDate.getTime()) / (1000 * 60 * 60 * 24));
      significance = Math.min(5, Math.max(1, daysDiff)); // 1-5 based on days difference
    }
    return { isNewer, changeType, significance, shouldWaitForRegular, skipDueToHierarchy };
  }
  
  // Case 3: Old is date-based, new has regular version -> need additional verification
  if (oldIsDate && newHasRegular) {
    // We can't automatically assume regular version is newer than date version
    // This requires post date comparison or SteamDB verification
    isNewer = false; // Don't assume it's newer yet
    changeType = 'date_to_regular_needs_verification';
    significance = 8; // High significance IF it's actually newer
    shouldWaitForRegular = false; // Mark that we need date/SteamDB verification
    return { isNewer, changeType, significance, shouldWaitForRegular, skipDueToHierarchy };
  }
  
  // Case 4: Regular version comparison (existing logic)
  if (oldVersion.version && newVersion.version && !oldIsDate && !newIsDate) {
    const oldParts = parseComparableVersionParts(oldVersion.version);
    const newParts = parseComparableVersionParts(newVersion.version);
    
    const maxLength = Math.max(oldParts.length, newParts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const oldPart = oldParts[i] || { number: 0, suffix: '' };
      const newPart = newParts[i] || { number: 0, suffix: '' };
      
      if (newPart.number > oldPart.number) {
        isNewer = true;
        if (i === 0) {
          changeType = 'major';
          significance = 10;
        } else if (i === 1) {
          changeType = 'minor';
          significance = 5;
        } else if (i === 2) {
          changeType = 'patch';
          significance = 3;
        } else {
          changeType = 'build';
          significance = 2;
        }
        break;
      }

      if (newPart.number === oldPart.number) {
        const suffixCmp = compareVersionSuffix(newPart.suffix, oldPart.suffix);
        if (suffixCmp > 0) {
          isNewer = true;
          changeType = i >= 2 ? 'patch' : (i === 1 ? 'minor' : 'major');
          significance = i === 0 ? 10 : i === 1 ? 5 : 3;
          break;
        }

        if (suffixCmp < 0) {
          break;
        }
      } else if (newPart.number < oldPart.number) {
        break;
      }
    }
  }
  
  // Build number comparison (existing logic)
  if (oldVersion.build && newVersion.build) {
    const oldBuild = parseInt(oldVersion.build);
    const newBuild = parseInt(newVersion.build);
    
    if (!isNaN(oldBuild) && !isNaN(newBuild)) {
      if (newBuild > oldBuild) {
        if (!isNewer || (newBuild - oldBuild) > 100) {
          isNewer = true;
          changeType = 'build';
          significance = Math.min(10, Math.max(2, Math.floor(Math.log10(newBuild - oldBuild))));
        }
      }
    }
  }

  // Check for suspicious version patterns (only for regular versions, not date versions)
  let suspiciousVersion = undefined;
  if (isNewer && oldVersion.version && newVersion.version && !oldVersion.isDateVersion && !newVersion.isDateVersion) {
    suspiciousVersion = detectSuspiciousVersion(oldVersion.version, newVersion.version);
  }

  return { isNewer, changeType, significance, shouldWaitForRegular, suspiciousVersion };
}


export async function enrichVersionInfoWithSteamDb(appId: number | undefined, versionInfo: VersionInfo): Promise<VersionInfo> {
  if (!appId || (!versionInfo.version && !versionInfo.build)) {
    return versionInfo;
  }

  const resolved = await resolveComparableVersionData(appId, {
    version: versionInfo.version,
    build: versionInfo.build,
    isDateVersion: versionInfo.isDateVersion,
  });

  if (!resolved.version && !resolved.build) {
    return versionInfo;
  }

  return {
    ...versionInfo,
    version: resolved.version || versionInfo.version,
    build: resolved.build || versionInfo.build,
    isDateVersion: resolved.resolvedFromDate ? false : versionInfo.isDateVersion,
    versionDate: resolved.resolvedFromDate ? undefined : versionInfo.versionDate,
    hasRegularVersion: resolved.version ? /^\d+\.\d+/.test(resolved.version) : versionInfo.hasRegularVersion,
    fullVersionString: `${resolved.version || versionInfo.version}${resolved.build || versionInfo.build ? ` Build ${resolved.build || versionInfo.build}` : ''}${versionInfo.releaseType ? ` ${versionInfo.releaseType}` : ''}`,
  };
}
