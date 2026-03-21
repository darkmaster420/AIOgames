import { NextResponse } from 'next/server';

import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel } from '../../../../utils/sequelDetection';
import { cleanGameTitle, cleanGameTitlePreserveEdition, decodeHtmlEntities, resolveComparableVersionData, resolvePubTimestampFromBuild, resolvePubTimestampFromVersion } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';

import { calculateGameSimilarity } from '../../../../utils/titleMatching';

interface GameSearchResult {
  id: string;
  title: string;
  link: string;
  date?: string;
  image?: string;
  description?: string;
  source: string;
  downloadLinks?: Array<{
    service: string;
    url: string;
    type: string;
  }>;
}

interface PendingUpdate {
  version: string;
  gameLink: string;
  _id?: string;
  newTitle?: string;
  detectedVersion?: string;
  reason?: string;
  dateFound?: string;
  downloadLinks?: Array<{
    service: string;
    url: string;
    type: string;
  }>;
}

interface VersionInfo {
  version: string;
  build: string;
  releaseType: string;
  updateType: string;
  baseTitle: string;
  fullVersionString: string;
  confidence: number;
  needsUserConfirmation: boolean;
  isDateVersion?: boolean;
}

async function enrichVersionInfoWithSteamDb(appId: number | undefined, versionInfo: VersionInfo): Promise<VersionInfo> {
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
    fullVersionString: `${resolved.version || versionInfo.version}${resolved.build || versionInfo.build ? ` Build ${resolved.build || versionInfo.build}` : ''}${versionInfo.releaseType ? ` ${versionInfo.releaseType}` : ''}`,
  };
}

interface TrackedGameDocument {
  _id: string;
  title: string;
  lastKnownVersion?: string;
  originalTitle?: string;
  versionNumberVerified?: boolean;
  currentVersionNumber?: string;
  buildNumberVerified?: boolean;
  currentBuildNumber?: string;
  pendingUpdates?: PendingUpdate[];
  steamVerified?: boolean;
  steamAppId?: number;
  steamName?: string;
}

const TRAILING_ROMAN_TO_ARABIC: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13',
  xiv: '14',
  xv: '15',
};

const TRAILING_ARABIC_TO_ROMAN: Record<string, string> = Object.fromEntries(
  Object.entries(TRAILING_ROMAN_TO_ARABIC).map(([roman, arabic]) => [arabic, roman])
);

function buildSearchTitleVariants(input: string): string[] {
  const base = String(input || '').trim().toLowerCase();
  if (!base) return [];

  const variants = new Set<string>([base]);

  const trailingRomanMatch = base.match(/\b(xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b\s*$/i);
  if (trailingRomanMatch) {
    const roman = trailingRomanMatch[1].toLowerCase();
    const arabic = TRAILING_ROMAN_TO_ARABIC[roman];
    if (arabic) {
      variants.add(base.replace(/\b(xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b\s*$/i, arabic));
    }
  }

  const trailingArabicMatch = base.match(/\b(1[0-5]|[1-9])\b\s*$/);
  if (trailingArabicMatch) {
    const arabic = trailingArabicMatch[1];
    const roman = TRAILING_ARABIC_TO_ROMAN[arabic];
    if (roman) {
      variants.add(base.replace(/\b(1[0-5]|[1-9])\b\s*$/, roman));
    }
  }

  return Array.from(variants);
}

// Helper function to check if we can auto-approve based on version/build numbers
async function canAutoApprove(game: TrackedGameDocument, newVersionInfo: VersionInfo, versionComparison?: { isNewer: boolean; changeType: string; significance: number; suspiciousVersion?: { isSuspicious: boolean; reason?: string } }): Promise<{canApprove: boolean; reason: string}> {
  let currentInfo: VersionInfo = {
    version: '',
    build: '',
    releaseType: '',
    updateType: '',
    baseTitle: '',
    fullVersionString: '',
    confidence: 0,
    needsUserConfirmation: false
  };
  
  logger.debug('Checking auto-approval conditions');

  if (game.steamAppId) {
    newVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, newVersionInfo);
  }

  // If publication timestamp already proved this update is newer, trust that signal.
  if (versionComparison?.isNewer && versionComparison.changeType === 'pub_timestamp') {
    return {
      canApprove: true,
      reason: 'Publication timestamp indicates a newer release'
    };
  }

  // If a version scheme mismatch was detected (e.g., game tracked as Build XXXXXXX but the
  // new release uses semver like v0.4.4f10), we cannot numerically compare across schemes.
  // The outer boost already verified strong title similarity + update indicator signals,
  // so we trust that context and auto-approve rather than silently dropping the update.
  if (versionComparison?.changeType === 'scheme_mismatch_unverified') {
    return {
      canApprove: true,
      reason: 'Version scheme changed (e.g., build number → semantic version). Strong title and update-indicator match confirm this is a valid update.'
    };
  }
  
  // Check if version is suspicious - if so, require user confirmation
  if (versionComparison?.suspiciousVersion?.isSuspicious) {
    return {
      canApprove: false,
      reason: `Suspicious version pattern detected: ${versionComparison.suspiciousVersion.reason}. Please verify before approving.`
    };
  }

  // If the outer comparison (which already incorporates pubdate resolution) shows a clear version or
  // build increase with significance >= 2, trust it directly instead of re-running the comparison.
  // This covers build-only updates (Build X → Build Y) and suffix patches (v0.4.3 → v0.4.3f).
  if (
    versionComparison?.isNewer &&
    (versionComparison.significance ?? 0) >= 2 &&
    versionComparison.changeType !== 'unknown' &&
    !versionComparison.changeType?.startsWith('rejected_')
  ) {
    return {
      canApprove: true,
      reason: `Version/build comparison indicates a newer release (${versionComparison.changeType}, significance: ${versionComparison.significance})`
    };
  }
  
  // First try verified version number
  if (game.versionNumberVerified && game.currentVersionNumber) {
    currentInfo = extractVersionInfo(game.currentVersionNumber);
    if (game.steamAppId) {
      currentInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, currentInfo);
    }
  logger.debug(`Checking verified version number: ${game.currentVersionNumber}`);
    
    const comparison = compareVersions(currentInfo, newVersionInfo);
    
    // Block suspicious versions even if version is verified
    if (comparison.suspiciousVersion?.isSuspicious) {
      return {
        canApprove: false,
        reason: `Suspicious version pattern detected: ${comparison.suspiciousVersion.reason}. Please verify before approving.`
      };
    }
    
    if (comparison.isNewer && comparison.significance >= 2) {
      return {
        canApprove: true,
        reason: `Verified version number shows significant update (${comparison.changeType}, significance: ${comparison.significance})`
      };
    }
  }

  // Then try verified build number
  if (game.buildNumberVerified && game.currentBuildNumber && newVersionInfo.build) {
  logger.debug(`Checking verified build number: ${game.currentBuildNumber} vs ${newVersionInfo.build}`);
    const currentBuild = parseInt(game.currentBuildNumber);
    const newBuild = parseInt(newVersionInfo.build);
    if (!isNaN(currentBuild) && !isNaN(newBuild) && newBuild > currentBuild) {
      return {
        canApprove: true,
        reason: `Verified build number is higher (${currentBuild} -> ${newBuild})`
      };
    }
  }

  // Try each title source in priority order
  // 0. Explicitly stored version/build numbers (most reliable baseline for comparison)
  // 1. Original title (most likely to have accurate version info)
  // 2. Last known version (previously verified)
  // 3. Steam enhanced title (if available)
  // 4. Clean title (fallback)
  const titleSources = [
    ...(game.currentVersionNumber ? [{ title: game.currentVersionNumber, label: 'current version number' }] : []),
    ...(game.currentBuildNumber ? [{ title: `Build ${game.currentBuildNumber}`, label: 'current build number' }] : []),
    { title: game.originalTitle, label: 'original title' },
    { title: game.lastKnownVersion, label: 'last known version' },
    { title: game.steamName, label: 'Steam enhanced title' },
    { title: game.title, label: 'clean title' }
  ].filter(source => source.title); // Remove undefined/null titles

  logger.debug('Checking version from available sources');

  for (const source of titleSources) {
    // Skip if title is undefined (shouldn't happen due to filter, but TypeScript doesn't know that)
    if (!source.title) continue;

    currentInfo = extractVersionInfo(source.title);
    if (game.steamAppId) {
      currentInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, currentInfo);
    }
    
    // If we found any version or build info, use this source
    if (currentInfo.version || currentInfo.build) {
      break;
    }
  }
    
    // Only proceed if we found a version or build number in both current and new
    if ((currentInfo.version && newVersionInfo.version) || (currentInfo.build && newVersionInfo.build)) {
      const comparison = compareVersions(currentInfo, newVersionInfo);
      
      // Block suspicious versions
      if (comparison.suspiciousVersion?.isSuspicious) {
        return {
          canApprove: false,
          reason: `Suspicious version pattern detected: ${comparison.suspiciousVersion.reason}. Please verify before approving.`
        };
      }
      
      // Auto-approve if:
      // 1. It's clearly a newer version with high significance
      if (comparison.isNewer && comparison.significance >= 2) {
        return {
          canApprove: true,
          reason: `Extracted version shows significant update (${comparison.changeType}, significance: ${comparison.significance})`
        };
      }
      
      // 2. We have build numbers and the new one is higher
      if (currentInfo.build && newVersionInfo.build) {
        const currentBuild = parseInt(currentInfo.build.replace(/[^\d]/g, ''));
        const newBuild = parseInt(newVersionInfo.build.replace(/[^\d]/g, ''));
        if (!isNaN(currentBuild) && !isNaN(newBuild) && newBuild > currentBuild) {
          return {
            canApprove: true,
            reason: `Extracted build number is higher (${currentBuild} -> ${newBuild})`
          };
        }
      }
      
      // 3. Clear version bump (e.g., 1.0 to 1.1, or 1.1 to 2.0)
      if (currentInfo.version && newVersionInfo.version && 
          comparison.isNewer && 
          comparison.changeType !== 'unknown' &&
          comparison.changeType !== 'patch') {
        return {
          canApprove: true,
          reason: `Clear version bump detected (${currentInfo.version} -> ${newVersionInfo.version})`
        };
      }
    }

  // No version info found to compare or auto-approval criteria met
  return {
    canApprove: false,
    reason: 'No clear version increase detected that meets auto-approval criteria'
  };
}

function extractVersionInfo(title: string): VersionInfo {
  // Keep original title for version and build extraction
  const originalTitle = title;
  const cleanTitle = cleanGameTitle(title);
  
  logger.debug(`Extracting version info from original: "${originalTitle}"`);
  logger.debug(`Extracting version info from cleaned: "${cleanTitle}"`);
  
  // Extract version patterns (from ORIGINAL title first, then cleaned)
  const versionPatterns = [
    // v1.2.3.45678 - Full version with build (most specific first)
    /v(\d+\.\d+\.\d+\.\d+)/i,
    // Date-based versions like v20250922, v2025.09.22
    /v(\d{4}[-.]?\d{2}[-.]?\d{2})/i,
    // Date-based versions - DD.MM.YY format like v30.09.25 (check for day <= 31, month <= 12)
    /v(\d{2}\.\d{2}\.\d{2})\b/i,
    // Date-based versions - 8 digits like v20250922
    /v(\d{8})/i,
    // v1.2.3a, v0.4.1f12, v1.2.3.a — letter suffix optionally followed by digits (post-release patches)
    /v(\d+(?:\.\d+)+(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,
    // Version 1.2.3a, Version 0.4.1f12, Version 1.2.3-beta, etc.
    /version\s*(\d+(?:\.\d+)+(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,
    // Standalone version numbers with suffixes (at least two parts like 1.2a, 0.4.1f12, 1.2.3c)
    /(\d+\.\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/,
  ];
  
  // Extract build patterns (from original title)
  const buildPatterns = [
    /build\s*#?(\d+)/i,
    /b(\d{4,})/i,
    /#(\d{4,})/i
  ];
  
  // Extract release type
  const releaseTypes = ['REPACK', 'PROPER', 'REAL PROPER', 'UNCUT', 'EXTENDED', 'DIRECTORS CUT', 'COMPLETE', 'GOTY', 'DEFINITIVE', 'ENHANCED'];
  const updateTypes = ['UPDATE', 'HOTFIX', 'PATCH', 'DLC', 'EXPANSION'];
  
  let version = '';
  let build = '';
  let releaseType = '';
  let updateType = '';
  let confidence = 1.0;
  
  logger.debug(`Extracting version info from: "${originalTitle}"`);

  // Extract version number from ORIGINAL TITLE first
  for (const pattern of versionPatterns) {
    const match = originalTitle.match(pattern);
    if (match) {
      logger.debug(`✅ Found version match in original with pattern ${pattern}: ${match[1]}`);
      version = match[1];
      confidence *= 0.9;
      break;
    }
  }
  
  // If no version found in original, try cleaned title
  if (!version) {
    for (const pattern of versionPatterns) {
      const match = cleanTitle.match(pattern);
      if (match) {
        logger.debug(`✅ Found version match in cleaned with pattern ${pattern}: ${match[1]}`);
        version = match[1];
        confidence *= 0.8; // Lower confidence for cleaned title
        break;
      }
    }
  }
  
  // Extract build number from original title
  for (const pattern of buildPatterns) {
    const match = originalTitle.match(pattern);
    if (match) {
      build = match[1];
      logger.debug(`✅ Found build match with pattern ${pattern}: ${build}`);
      confidence *= 0.85;
      break;
    }
  }
  
  // Check for release type keywords
  for (const type of releaseTypes) {
    if (cleanTitle.includes(type)) {
      releaseType = type;
      confidence *= 0.95;
      break;
    }
  }
  
  // Check for update type keywords
  for (const type of updateTypes) {
    if (cleanTitle.includes(type)) {
      updateType = type;
      confidence *= 0.9;
      break;
    }
  }
  
  // Detect if this is a date-based version (DD.MM.YY format)
  let isDateVersion = false;
  if (version) {
    const dateMatch = version.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);
      // Valid date check: day 1-31, month 1-12
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        isDateVersion = true;
        logger.debug(`✅ Detected date-based version: ${version} (DD.MM.YY format)`);
      }
    }
  }
  
  return {
    version,
    build,
    releaseType,
    updateType,
    baseTitle: cleanTitle,
    fullVersionString: `${version}${build ? ` Build ${build}` : ''}${releaseType ? ` ${releaseType}` : ''}`,
    confidence,
    needsUserConfirmation: confidence < 0.7,
    isDateVersion
  };
}

/**
 * Detect suspicious version patterns that might indicate invalid versioning
 * Examples: v6.6.0.0 when expecting v6.06, or excessive version jumps
 */
function detectSuspiciousVersion(oldVersion: string, newVersion: string): { isSuspicious: boolean; reason?: string } {
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

function compareVersions(oldVersion: VersionInfo, newVersion: VersionInfo): { isNewer: boolean; changeType: string; significance: number; suspiciousVersion?: { isSuspicious: boolean; reason?: string } } {
  let isNewer = false;
  let changeType = 'unknown';
  let significance = 0;
  
  logger.debug(`🔍 Comparing versions: "${oldVersion.version}" vs "${newVersion.version}"`);
  
  // Compare versions if both have them
  if (oldVersion.version && newVersion.version) {
    const oldParts = parseComparableVersionParts(oldVersion.version);
    const newParts = parseComparableVersionParts(newVersion.version);
    
    logger.debug(`🔍 Version parts: [${oldParts.map(p => `${p.number}${p.suffix ? p.suffix : ''}`).join(',')}] vs [${newParts.map(p => `${p.number}${p.suffix ? p.suffix : ''}`).join(',')}]`);
    
    const maxLength = Math.max(oldParts.length, newParts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const oldPart = oldParts[i] || { number: 0, suffix: '' };
      const newPart = newParts[i] || { number: 0, suffix: '' };
      
      logger.debug(`🔍 Comparing part ${i}: ${oldPart.number}${oldPart.suffix} vs ${newPart.number}${newPart.suffix}`);
      
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
          // For build numbers or additional parts
          changeType = 'build';
          significance = 2;
        }
        logger.debug(`✅ Version is newer: ${changeType} (significance: ${significance})`);
        break;
      }

      if (newPart.number === oldPart.number) {
        const suffixCmp = compareVersionSuffix(newPart.suffix, oldPart.suffix);
        if (suffixCmp > 0) {
          isNewer = true;
          changeType = i >= 2 ? 'patch' : (i === 1 ? 'minor' : 'major');
          significance = i === 0 ? 10 : i === 1 ? 5 : 3;
          logger.debug(`✅ Version suffix indicates newer release: ${changeType} (significance: ${significance})`);
          break;
        }

        if (suffixCmp < 0) {
          logger.debug(`❌ Version suffix indicates older release`);
          changeType = 'version_older';
          break;
        }
      } else if (newPart.number < oldPart.number) {
        logger.debug(`❌ Version is older`);
        changeType = 'version_older';
        break; // Older version
      }
    }
  }
  
  // Compare builds if both have them
  if (oldVersion.build && newVersion.build) {
    const oldBuild = parseInt(oldVersion.build);
    const newBuild = parseInt(newVersion.build);
    
    if (!isNaN(oldBuild) && !isNaN(newBuild)) {
      if (newBuild > oldBuild) {
        // If we haven't found a version difference or the build difference is more significant
        if (!isNewer || (newBuild - oldBuild) > 100) {
          isNewer = true;
          changeType = 'build';
          // Calculate significance based on the difference
          significance = Math.min(10, Math.max(2, Math.floor(Math.log10(newBuild - oldBuild))));
        }
      } else if (newBuild < oldBuild && !isNewer) {
        // New build is definitively older — mark it so the keyword boost won't treat it as unknown
        changeType = 'build_older';
      }
    }
  }

  // Consider release types if no clear version/build difference
  if (!isNewer && oldVersion.releaseType !== newVersion.releaseType) {
    const releaseTypeOrder = {
      'BETA': 1,
      'RC': 2,
      'RELEASE': 3,
      'REPACK': 3,
      'PROPER': 4,
      'COMPLETE': 5,
      'GOTY': 6,
      'DEFINITIVE': 7
    };
    
    const oldType = releaseTypeOrder[oldVersion.releaseType as keyof typeof releaseTypeOrder] || 0;
    const newType = releaseTypeOrder[newVersion.releaseType as keyof typeof releaseTypeOrder] || 0;
    
    if (newType > oldType) {
      isNewer = true;
      changeType = 'release_type';
      significance = 3;
    }
  }

  // Check for suspicious version patterns
  let suspiciousVersion = undefined;
  if (isNewer && oldVersion.version && newVersion.version) {
    suspiciousVersion = detectSuspiciousVersion(oldVersion.version, newVersion.version);
    if (suspiciousVersion.isSuspicious) {
      logger.warn(`⚠️ Suspicious version pattern detected: ${suspiciousVersion.reason}`);
    }
  }

  return { isNewer, changeType, significance, suspiciousVersion };
}

type VersionScheme = 'semver' | 'build' | 'date' | 'unknown';

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
    const letterOffset = letterDigitMatch[1].charCodeAt(0) - 97; // 0 for 'a', 5 for 'f', etc.
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

function detectVersionScheme(info: VersionInfo): VersionScheme {
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

function parsePubTimestamp(value?: string | Date | number | null): number {
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

// POST: Check for updates for a specific game using the search API
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId } = await request.json();

    if (!gameId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find the game to check
    const game = await TrackedGame.findOne({
      _id: gameId,
      userId: user.id,
      isActive: true
    });

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    logger.info(`🎮 Checking updates for single game: ${game.title}`);

    let updatesFound = 0;
    let sequelsFound = 0;
    const results = [];

    // Get the clean title for matching results against tracked title.
    // Also compute a cleaned Steam name so similarity checks can use the best score of either.
    const cleanTitle = cleanGameTitle(game.title);
    const cleanSteamTitle = game.steamName ? cleanGameTitle(game.steamName) : null;

    // Build search query: prefer Steam name (most accurate) then fall back to cleaned title.
    // This is important for games whose scene/tracker title differs from the Steam name
    // (e.g. "Schedule I" vs "Schedule 1").
    const steamSearchBase = game.steamName
      ? cleanGameTitlePreserveEdition(game.steamName)
      : cleanGameTitlePreserveEdition(game.title);
    const fallbackSearchBase = cleanGameTitlePreserveEdition(game.title);

    // Merge variants from both sources (deduplicated) so we catch both spellings
    const allVariantSet = new Set<string>([
      ...buildSearchTitleVariants(steamSearchBase),
      ...buildSearchTitleVariants(fallbackSearchBase),
    ]);
    const searchVariants = Array.from(allVariantSet);

    logger.debug(`🔍 Searching for variants: ${searchVariants.map(v => `"${v}"`).join(', ')} (steam="${game.steamName || 'none'}", title="${game.title}")`);

    // Use the same search API that the main search uses
    const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
    const mergedResults: GameSearchResult[] = [];

    // Fetch title-based search results AND the recent-uploads feed in parallel.
    // The search endpoint has a 1-hour Cloudflare cache: if a post was published after
    // the cache was last populated, it won't appear in search results. The recent-uploads
    // feed is refreshed much more frequently (stale-while-revalidate) so it catches new
    // posts that haven't yet made it into the search cache.
    const [searchResponses, recentResponse] = await Promise.allSettled([
      Promise.all(
        searchVariants.map(variant =>
          fetch(`${baseUrl}/?search=${encodeURIComponent(variant)}`)
            .then(async r => {
              if (!r.ok) { logger.warn(`Search API failed for "${variant}": ${r.status}`); return null; }
              const d = await r.json();
              return (d.success && Array.isArray(d.results)) ? d.results as GameSearchResult[] : null;
            })
            .catch(e => { logger.warn(`Search fetch error for "${variant}":`, e); return null; })
        )
      ),
      fetch(`${baseUrl}/recent`)
        .then(async r => {
          if (!r.ok) return null;
          const d = await r.json();
          return (d.success && Array.isArray(d.results)) ? d.results as GameSearchResult[] : null;
        })
        .catch(e => { logger.warn('Recent-uploads fetch error:', e); return null; })
    ]);

    if (searchResponses.status === 'fulfilled') {
      for (const batch of searchResponses.value) {
        if (batch) mergedResults.push(...batch);
      }
    }

    // Merge recent-uploads: only include results that have reasonable title similarity
    // so we don't bloat the processing set with completely unrelated games.
    if (recentResponse.status === 'fulfilled' && recentResponse.value) {
      const recentPosts = recentResponse.value;
      logger.debug(`📰 Recent-uploads feed returned ${recentPosts.length} posts`);
      for (const post of recentPosts) {
        const postClean = cleanGameTitle(decodeHtmlEntities(post.title));
        const sim = Math.max(
          calculateGameSimilarity(cleanTitle, postClean),
          cleanSteamTitle ? calculateGameSimilarity(cleanSteamTitle, postClean) : 0
        );
        if (sim >= 0.70) {
          mergedResults.push(post);
          logger.debug(`📰 Added from recent feed (sim=${sim.toFixed(2)}): "${post.title}"`);
        }
      }
    }

    // Extract results from merged API responses
    let games: GameSearchResult[] = [];
    if (mergedResults.length > 0) {
      games = mergedResults;
    } else {
      throw new Error('Search API request returned no results for all title variants');
    }
    
    logger.debug(`📊 Search returned ${games.length} results`);

    // Remove duplicate posts by link (same post can appear multiple times)
    try {
      const seenLinks = new Map<string, GameSearchResult>();
      for (const g of games) {
        const key = g.link || g.id || g.title;
        const date = g.date ? new Date(g.date) : new Date(0);
        const existing = seenLinks.get(key);
        if (!existing) {
          seenLinks.set(key, g);
        } else {
          // Keep the one with the newer date if duplicates found
          const existingDate = existing.date ? new Date(existing.date) : new Date(0);
          if (date > existingDate) seenLinks.set(key, g);
        }
      }

      games = Array.from(seenLinks.values());
      // Sort by date (newest first) to check newer versions first
      games.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
      
      logger.debug(`🔎 Processing ${games.length} unique results (sorted by date)`);
    } catch (dedupeErr) {
      logger.error('Failed to deduplicate search results:', dedupeErr);
      // fall back to original games list
    }

    // Process results to find updates and sequels
    for (const result of games) {
      const decodedTitle = decodeHtmlEntities(result.title);
      const cleanedDecodedTitle = cleanGameTitle(decodedTitle);
      // Use the best similarity between the tracked title and the Steam name so that
      // games like "Schedule I" (tracked) still match results titled "Schedule 1 v0.4.3f".
      const similarity = Math.max(
        calculateGameSimilarity(cleanTitle, cleanedDecodedTitle),
        cleanSteamTitle ? calculateGameSimilarity(cleanSteamTitle, cleanedDecodedTitle) : 0
      );

      logger.debug(`Processing: "${decodedTitle}" (similarity: ${similarity.toFixed(2)})`);

      // Skip if this is the same post we're already tracking
      if (result.link === game.gameLink) {
        logger.debug(`⏩ Skipping current tracked post: "${decodedTitle}"`);
        continue;
      }

      // --- Require a valid version/build pattern in the detected title (but be more lenient) ---
      // Use ESM import for detectVersionNumber
      // IMPORTANT: Check the ORIGINAL decoded title, not the cleaned one (which strips versions)
      const { detectVersionNumber } = await import('../../../../utils/versionDetection');
      const { found: hasVersion } = detectVersionNumber(decodedTitle);
      const hasBuild = /\b(build|b|#)\s*\d{3,}\b/i.test(decodedTitle);
      const hasDatePattern = /\b\d{4}[-\.]\d{2}[-\.]\d{2}\b/.test(decodedTitle);
      const hasUpdateKeywords = /\b(update|patch|v\d|rev|repack|hotfix|fixed|latest|final|complete|enhanced|improved)\b/i.test(decodedTitle);
      
      logger.debug(`🔍 Pattern check - hasVersion: ${hasVersion}, hasBuild: ${hasBuild}, hasDate: ${hasDatePattern}, hasKeywords: ${hasUpdateKeywords}`);
      
      if (!hasVersion && !hasBuild && !hasDatePattern && !hasUpdateKeywords) {
        logger.debug(`⏩ Skipping "${decodedTitle}" (no version/build/update pattern)`);
        continue;
      }

      // Check for potential updates (more lenient similarity threshold)
      if (similarity >= 0.75) {
        // Try sources in priority order for current version
        const titleSources = [
          // Explicitly-stored version/build numbers are the most reliable baseline
          ...(game.currentVersionNumber ? [{ title: game.currentVersionNumber, label: 'current version number' }] : []),
          ...(game.currentBuildNumber ? [{ title: `Build ${game.currentBuildNumber}`, label: 'current build number' }] : []),
          { title: game.originalTitle, label: 'original title' },
          { title: game.lastKnownVersion, label: 'last known version' },
          { title: game.steamName, label: 'Steam enhanced title' },
          { title: game.title, label: 'clean title' }
        ].filter(source => source.title);

        let currentVersionInfo = null;
        for (const source of titleSources) {
          if (!source.title) continue;
          
          const info = extractVersionInfo(source.title);
          if (info.version || info.build) {
            logger.debug(`✅ Using version info from ${source.label}: "${source.title}"`);
            currentVersionInfo = info;
            break;
          }
        }
        
        // If we didn't find any version info, use the last source
        if (!currentVersionInfo) {
          currentVersionInfo = extractVersionInfo(titleSources[titleSources.length - 1].title);
        }

        let newVersionInfo = extractVersionInfo(decodedTitle);

        // Enrich version/build via SteamDB Worker if one side is missing and we know the appId
        if (game.steamAppId) {
          try {
            currentVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, currentVersionInfo);
            newVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, newVersionInfo);
          } catch (e) {
            logger.debug('ℹ️ SteamDB enrichment skipped due to error:', e instanceof Error ? e.message : 'unknown');
          }
        }
        
        let comparison = compareVersions(currentVersionInfo, newVersionInfo);
        const currentScheme = detectVersionScheme(currentVersionInfo);
        const newScheme = detectVersionScheme(newVersionInfo);
        const schemesMismatchOrUnknown = currentScheme !== newScheme || currentScheme === 'unknown' || newScheme === 'unknown';

        // --- Resolve current pub timestamp ---
        // Priority: SteamDB build (most accurate) → SteamDB version → stored lastPubTimestamp → lastVersionDate
        let currentPubTimestamp = 0;

        if (game.steamAppId && (game.currentBuildNumber || currentVersionInfo.build)) {
          const currentBuildForTimestamp = game.currentBuildNumber || currentVersionInfo.build;
          if (currentBuildForTimestamp) {
            const resolvedCurrentPubTs = await resolvePubTimestampFromBuild(game.steamAppId, currentBuildForTimestamp);
            if (typeof resolvedCurrentPubTs === 'number' && resolvedCurrentPubTs > 0) {
              currentPubTimestamp = resolvedCurrentPubTs;
              logger.debug(`🕒 Resolved current pub timestamp from SteamDB build ${currentBuildForTimestamp}: ${currentPubTimestamp}`);
            }
          }
        }

        if (currentPubTimestamp <= 0 && game.steamAppId && (game.currentVersionNumber || currentVersionInfo.version)) {
          const currentVersionForTimestamp = game.currentVersionNumber || currentVersionInfo.version;
          if (currentVersionForTimestamp) {
            const resolvedCurrentPubTsFromVersion = await resolvePubTimestampFromVersion(game.steamAppId, currentVersionForTimestamp);
            if (typeof resolvedCurrentPubTsFromVersion === 'number' && resolvedCurrentPubTsFromVersion > 0) {
              currentPubTimestamp = resolvedCurrentPubTsFromVersion;
              logger.debug(`🕒 Resolved current pub timestamp from SteamDB version ${currentVersionForTimestamp}: ${currentPubTimestamp}`);
            }
          }
        }

        if (currentPubTimestamp <= 0 && typeof game.lastPubTimestamp === 'number' && game.lastPubTimestamp > 0) {
          currentPubTimestamp = game.lastPubTimestamp;
          logger.debug(`🕒 Using stored lastPubTimestamp as current baseline: ${currentPubTimestamp}`);
        }

        if (currentPubTimestamp <= 0) {
          currentPubTimestamp = parsePubTimestamp(game.lastVersionDate);
          if (currentPubTimestamp > 0) {
            logger.debug(`🕒 Using stored post date as current baseline: ${currentPubTimestamp}`);
          }
        }

        // --- Resolve new pub timestamp ---
        // Priority: SteamDB build (most accurate) → SteamDB version → feed date
        // We always try SteamDB first because feed/post dates from scene sites are
        // unreliable proxies; the Steam build pub_timestamp is the authoritative source.
        let newPubTimestamp = 0;

        if (game.steamAppId && newVersionInfo.build) {
          const resolvedPubTs = await resolvePubTimestampFromBuild(game.steamAppId, newVersionInfo.build);
          if (typeof resolvedPubTs === 'number' && resolvedPubTs > 0) {
            newPubTimestamp = resolvedPubTs;
            logger.debug(`🕒 Resolved new pub timestamp from SteamDB build ${newVersionInfo.build}: ${newPubTimestamp}`);
          }
        }

        if (newPubTimestamp <= 0 && game.steamAppId && newVersionInfo.version) {
          const resolvedPubTsFromVersion = await resolvePubTimestampFromVersion(game.steamAppId, newVersionInfo.version);
          if (typeof resolvedPubTsFromVersion === 'number' && resolvedPubTsFromVersion > 0) {
            newPubTimestamp = resolvedPubTsFromVersion;
            logger.debug(`🕒 Resolved new pub timestamp from SteamDB version ${newVersionInfo.version}: ${newPubTimestamp}`);
          }
        }

        if (newPubTimestamp <= 0) {
          newPubTimestamp = parsePubTimestamp(result.date);
          if (newPubTimestamp > 0) {
            logger.debug(`🕒 Using feed date as new pub timestamp fallback: ${newPubTimestamp}`);
          }
        }

        // Last-resort fallback: if the current baseline was resolved from post date AND the new
        // result has a feed date, compare the two post dates directly.
        // This lets us at least say "the scene post is newer than the one we're tracking" when
        // SteamDB has no data for either side.
        const currentPostDate = parsePubTimestamp(game.lastVersionDate);
        const newPostDate = parsePubTimestamp(result.date);
        if (newPubTimestamp <= 0 && currentPubTimestamp <= 0 && currentPostDate > 0 && newPostDate > 0) {
          // Both sides only have post dates — compare them directly
          logger.debug(`🕒 Post-date vs post-date fallback: current=${currentPostDate}, new=${newPostDate}`);
          currentPubTimestamp = currentPostDate;
          newPubTimestamp = newPostDate;
        } else if (newPubTimestamp <= 0 && currentPubTimestamp > 0 && newPostDate > 0) {
          // Current has a proper baseline but new only has its post date — use post date for new
          newPubTimestamp = newPostDate;
          logger.debug(`🕒 Using new post date as fallback for new pub timestamp: ${newPubTimestamp}`);
        }

        // Absolute last resort: if we still have no current baseline, use the game's dateAdded.
        // Semantically: "the game was last known-good when tracking started, so any post after
        // that date is potentially newer." This handles scheme-switch cases (build→semver) where
        // lastVersionDate and lastPubTimestamp are both unset.
        if (currentPubTimestamp <= 0 && (newPubTimestamp > 0 || newPostDate > 0)) {
          const dateAddedTs = parsePubTimestamp(game.dateAdded);
          if (dateAddedTs > 0) {
            currentPubTimestamp = dateAddedTs;
            if (newPubTimestamp <= 0) newPubTimestamp = newPostDate;
            logger.debug(`🕒 Last-resort baseline: dateAdded=${dateAddedTs}, new pub timestamp=${newPubTimestamp}`);
          }
        }

        const hasComparablePubTimestamps = currentPubTimestamp > 0 && newPubTimestamp > 0;
        const pubTimestampDelta = hasComparablePubTimestamps ? (newPubTimestamp - currentPubTimestamp) : 0;

        if (hasComparablePubTimestamps && pubTimestampDelta !== 0) {
          comparison = {
            ...comparison,
            isNewer: pubTimestampDelta > 0,
            changeType: pubTimestampDelta > 0 ? 'pub_timestamp' : 'pub_timestamp_older',
            significance: pubTimestampDelta > 0 ? Math.max(comparison.significance, 1) : 0,
          };
          logger.debug(`🕒 Publication timestamp precedence (${currentScheme} vs ${newScheme}): ${currentPubTimestamp} -> ${newPubTimestamp}`);
        }

        // When schemes are incompatible and pub_timestamp didn't resolve it, don't trust string comparison
        if (schemesMismatchOrUnknown && comparison.changeType !== 'pub_timestamp' && comparison.changeType !== 'pub_timestamp_older') {
          comparison = {
            ...comparison,
            isNewer: false,
            changeType: 'scheme_mismatch_unverified',
            significance: 0,
          };
          logger.debug(`⚠️ Scheme mismatch (${currentScheme} vs ${newScheme}) — skipping string comparison, pub_timestamp required`);
        }

        logger.debug(`📊 Comparison: isNewer=${comparison.isNewer}, current="${currentVersionInfo.version || currentVersionInfo.build}", new="${newVersionInfo.version || newVersionInfo.build}"`);
        
        // Version/regex detection
        let isUpdateCandidate = false;
        
        // Primary detection: version comparison
        isUpdateCandidate = comparison.isNewer || newVersionInfo.needsUserConfirmation;
        
        // Boost for strong update indicators
        const titleLower = decodedTitle.toLowerCase();
        const gameTitle = game.title.toLowerCase();
        
        const updateKeywords = [
          'update', 'patch', 'hotfix', 'build', 'version', 'v\\d', 'rev', 'fixed',
          'bugfix', 'new version', 'latest', 'improved', 'enhanced', 'repack',
          'director.*cut', 'goty', 'complete.*edition', 'final.*cut'
        ];
        
        let updateIndicators = 0;
        for (const keyword of updateKeywords) {
          const regex = new RegExp(keyword, 'i');
          if (regex.test(titleLower) && !regex.test(gameTitle)) {
            updateIndicators++;
          }
        }
        
        const versionPatterns = [
          /v\d+\.\d+\.\d+/i, /\d+\.\d+\.\d+/, /build\s*\d+/i, /patch\s*\d+/i,
          /update\s*\d+/i, /rev\s*\d+/i, /r\d+/i, /v\d{8}/i, /\d{4}[-\.]\d{2}[-\.]\d{2}/
        ];
        
        for (const pattern of versionPatterns) {
          if (pattern.test(decodedTitle)) {
            updateIndicators++;
          }
        }
        
        // Boost if strong indicators present — but never override a definitive "older" result.
        // Also allow scheme_mismatch_unverified: this fires when schemes differ (e.g. tracked as
        // build-number, new post uses semver) and pub_timestamp couldn't resolve it. In that case
        // strong update signals (version pattern + update keyword) are the only reliable guide.
        if (updateIndicators >= 2 && similarity >= 0.85 &&
            (comparison.isNewer || comparison.changeType === 'unknown' || comparison.changeType === 'scheme_mismatch_unverified')) {
          isUpdateCandidate = true;
        }
        
        logger.debug(`🎯 Final decision: isUpdateCandidate=${isUpdateCandidate}, hasVersion=${!!newVersionInfo.version}, hasBuild=${!!newVersionInfo.build}`);
        
        // Only proceed if it's a candidate and has some version info
        if (isUpdateCandidate && (newVersionInfo.version || newVersionInfo.build)) {
          logger.debug(`🔗 Download links in result:`, result.downloadLinks);
          
          // Check if we already have this update in pending or history (fresh DB query to avoid race conditions)
          const freshGame = await TrackedGame.findById(game._id).lean() as {
            pendingUpdates?: Array<{ detectedVersion?: string; build?: string; version?: string; gameLink?: string; newLink?: string }>;
            updateHistory?: Array<{ version?: string; build?: string; gameLink: string }>;
          } | null;

          const candidateBuild = String(newVersionInfo.build || '').trim();
          const candidateDetectedVersion = String(newVersionInfo.fullVersionString || newVersionInfo.version || '').trim().toLowerCase();

          const isSameSignature = (entryBuild?: string, entryVersion?: string) => {
            const normalizedBuild = String(entryBuild || '').trim();
            const normalizedVersion = String(entryVersion || '').trim().toLowerCase();

            if (candidateBuild && normalizedBuild) {
              return candidateBuild === normalizedBuild;
            }

            if (candidateDetectedVersion && normalizedVersion) {
              return normalizedVersion.includes(candidateDetectedVersion) || candidateDetectedVersion.includes(normalizedVersion);
            }

            return !candidateBuild && !candidateDetectedVersion;
          };

          const existingPending = freshGame?.pendingUpdates?.some((pending) =>
            (pending.gameLink === result.link || pending.newLink === result.link) &&
            isSameSignature(pending.build, pending.detectedVersion || pending.version)
          );

          const existingInHistory = freshGame?.updateHistory?.some((update) =>
            update.gameLink === result.link &&
            isSameSignature(update.build, update.version)
          );
          
          if (existingPending || existingInHistory) {
            logger.info(`⏩ Skipping duplicate update (already in ${existingInHistory ? 'updateHistory' : 'pendingUpdates'}): ${result.link}`);
          } else {
            // Check if we can auto-approve based on verified version/build numbers
            const autoApproveResult = await canAutoApprove(game, newVersionInfo, comparison);
            logger.debug(`\n🤖 Auto-approval decision:`, autoApproveResult);
            
              // Create base update data (enhanced with AI information)
            const updateData = {
              version: decodedTitle, // Full title with version (e.g., "TEKKEN 8 v2.06.01-P2P")
              detectedVersion: newVersionInfo.fullVersionString || newVersionInfo.version || newVersionInfo.build, // Clean version number
              newTitle: cleanedDecodedTitle, // Cleaned game title without version
              newLink: result.link,
              gameLink: result.link,
              build: newVersionInfo.build,
              releaseType: newVersionInfo.releaseType,
              updateType: newVersionInfo.updateType,
              changeType: comparison.changeType,
              significance: comparison.significance,
              dateFound: new Date().toISOString(),
              pub_timestamp: parsePubTimestamp(result.date) || null,
              previousVersion: game.lastKnownVersion || game.title,
              downloadLinks: result.downloadLinks || [],
              steamEnhanced: false,
              steamAppId: game.steamAppId,
              needsUserConfirmation: !autoApproveResult.canApprove && (newVersionInfo.needsUserConfirmation || comparison.significance < 2),
              autoApprovalReason: autoApproveResult.reason,
              confidence: newVersionInfo.confidence || similarity,
              reason: autoApproveResult.reason || 'Version number detected',
            };

            if (autoApproveResult.canApprove) {
              logger.debug(`\n✅ Auto-approving update with reason: ${autoApproveResult.reason}`);
              
              // Auto-approve the update
              const approvedUpdate = {
                ...updateData,
                changeType: 'user_approved', // Use user_approved instead of automatic for proper notification formatting
                userApproved: true,
                approvedAt: new Date(),
                autoApprovalReason: autoApproveResult.reason
              };              
              
              // Update the game with auto-approved update
              const updateFields: Record<string, unknown> = {
                lastKnownVersion: newVersionInfo.fullVersionString || newVersionInfo.version || newVersionInfo.build || decodedTitle,
                lastVersionDate: new Date().toISOString(),
                lastPubTimestamp: parsePubTimestamp(result.date) || Date.now(),
                dateAdded: new Date(), // Move game to top when single-check auto-approved update is detected
                title: cleanedDecodedTitle,
                originalTitle: decodedTitle,
                gameLink: result.link,
                ...(result.image && { image: result.image }),
                $push: {
                  updateHistory: {
                    $each: [{
                      ...approvedUpdate,
                      isLatest: true
                    }],
                    $position: 0
                  }
                },
                lastChecked: new Date(),
                latestApprovedUpdate: {
                  version: decodedTitle,
                  dateFound: new Date().toISOString(),
                  gameLink: result.link,
                  downloadLinks: result.downloadLinks || []
                },
                // Set new update indicator for auto-approved updates
                hasNewUpdate: true,
                newUpdateSeen: false
              };

              // Update version or build numbers based on what was detected
              if (newVersionInfo.version) {
                updateFields.currentVersionNumber = newVersionInfo.version;
                updateFields.versionNumberVerified = true;
                updateFields.versionNumberSource = 'automatic';
                updateFields.versionNumberLastUpdated = new Date();
                logger.debug(`✅ Updated version number to: ${newVersionInfo.version}`);
              }
              
              if (newVersionInfo.build) {
                updateFields.currentBuildNumber = newVersionInfo.build;
                updateFields.buildNumberVerified = true;
                updateFields.buildNumberSource = 'automatic';
                updateFields.buildNumberLastUpdated = new Date();
                logger.debug(`✅ Updated build number to: ${newVersionInfo.build}`);
              }

              // Atomic conditional update to prevent duplicate auto-approvals
              const hasCandidateSignature = !!(candidateBuild || candidateDetectedVersion);

              const autoApproveResult2 = await TrackedGame.findOneAndUpdate(
                hasCandidateSignature
                  ? { _id: game._id }
                  : {
                      _id: game._id,
                      'updateHistory.gameLink': { $ne: result.link },
                      'pendingUpdates.gameLink': { $ne: result.link },
                      'pendingUpdates.newLink': { $ne: result.link }
                    },
                updateFields,
                { new: true }
              );

              if (!autoApproveResult2) {
                logger.info(`⏩ Skipping duplicate auto-approval (atomic check): ${result.link}`);
                continue;
              }
              
            } else {
              logger.debug(`⏩ Skipping update that could not be auto-approved: "${decodedTitle}" (${autoApproveResult.reason})`);
              continue;
            }

            // Send notification for the update only if enabled for this game
            if (game.notificationsEnabled) {
              try {
                const notificationData = createUpdateNotificationData({
                  gameTitle: game.title,
                  version: decodedTitle,
                  updateType: 'update', // Always 'update' for version updates
                  gameLink: result.link,
                  imageUrl: result.image,
                  downloadLinks: result.downloadLinks,
                  previousVersion: game.lastKnownVersion || game.title
                });
                
                logger.debug(`📤 Notification data:`, {
                  downloadLinks: notificationData.downloadLinks,
                  hasDownloadLinks: !!(notificationData.downloadLinks && notificationData.downloadLinks.length > 0)
                });
                
                await sendUpdateNotification(game.userId.toString(), notificationData);
                
                // Mark notification as sent in updateHistory
                await TrackedGame.updateOne(
                  { _id: game._id, 'updateHistory.gameLink': result.link },
                  { $set: { 'updateHistory.$.notificationSent': true } }
                );
                
                logger.debug(`📢 Auto-approved update notification sent for ${game.title}`);
              } catch (notificationError) {
                logger.error(`Failed to send update notification for ${game.title}:`, notificationError);
                // Don't fail the whole operation if notification fails
              }
            } else {
              logger.info(`Update found for ${game.title} but notifications are disabled`);
            }

            updatesFound++;
            results.push({
              gameTitle: game.title,
              update: updateData,
              autoApproved: autoApproveResult.canApprove
            });
            
            const status = '✅ Auto-approved';
            logger.info(`${status} update for ${game.title}: ${newVersionInfo.fullVersionString || newVersionInfo.version || decodedTitle}`);
            
            // For single check, only process the first (newest) update
            break;
          }
        }
      }
      
      // Check for sequels (moderate similarity)
      else if (similarity >= 0.5) {
        logger.debug(`🎲 Checking for sequel match in: ${decodedTitle}`);
        
        const sequelResult = await detectSequel(game.title, decodedTitle);
        
        if (sequelResult && sequelResult.isSequel) {
          logger.debug(`🎮 Potential sequel found: ${decodedTitle}`);
          
          // Add to sequel notifications if not already there
          const existingSequel = game.sequelNotifications?.some((sequel: { detectedTitle: string; gameLink: string }) => 
            sequel.detectedTitle === decodedTitle && sequel.gameLink === result.link
          );
          
          if (!existingSequel) {
            // Send sequel notification
            try {
              const notificationData = createUpdateNotificationData({
                gameTitle: game.title,
                gameLink: result.link,
                imageUrl: result.image,
                updateType: 'sequel'
              });
              
              await sendUpdateNotification(game.userId.toString(), notificationData);
              logger.debug(`📢 Sequel notification sent for ${game.title} -> ${decodedTitle}`);
            } catch (notificationError) {
              logger.error(`Failed to send sequel notification for ${game.title}:`, notificationError);
              // Don't fail the whole operation if notification fails
            }

            sequelsFound++;
            results.push({
              gameTitle: game.title,
              sequel: {
                title: decodedTitle,
                link: result.link,
                similarity,
                type: sequelResult?.sequelType || 'unknown'
              }
            });
            
            logger.debug(`📝 Added sequel notification for ${game.title}: ${decodedTitle}`);
          }
        }
      }
    }

    logger.debug(`\n✨ Check complete for ${game.title}:`);
    logger.debug(`   Updates found: ${updatesFound}`);
    logger.debug(`   Sequels found: ${sequelsFound}`);

    return NextResponse.json({
      message: 'Game check complete',
      game: game.title,
      checked: 1,
      updatesFound,
      sequelsFound,
      results
    });

  } catch (error) {
    logger.error('Single game check error:', error);
    return NextResponse.json(
      { error: 'Failed to check game for updates' },
      { status: 500 }
    );
  }
}