import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import mongoose from 'mongoose';
import { detectSequel } from '../../../../utils/sequelDetection';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';
import { cleanGameTitle, decodeHtmlEntities, extractReleaseGroup, is0xdeadcodeRelease, isOnlineFixRelease, resolveComparableVersionData, resolvePubTimestampFromBuild, resolvePubTimestampFromVersion } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';

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

interface VersionInfo {
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

interface EnhancedMatch {
  game: GameSearchResult;
  similarity: number;
  versionInfo: VersionInfo;
  gate: string;
  enhancedScore?: number;
}

// Helper function to fetch full download links from GameAPI
async function fetchDownloadLinks(game: GameSearchResult): Promise<Array<{ service: string; url: string; type: string }>> {
  try {
    const gameApiUrl = process.env.GAME_API_URL || 'https://gameapi.iforgor.cc';
    
    // Extract the original ID and site type from the composite ID
    // Format: "siteType_originalId" (e.g., "skidrow_518912")
    const [siteType, originalId] = game.id.split('_');
    
    if (!siteType || !originalId) {
      logger.warn(`Invalid game ID format: ${game.id}`);
      return [];
    }
    
    const postUrl = `${gameApiUrl}/post?id=${originalId}&site=${siteType}`;
    logger.debug(`Fetching download links from: ${postUrl}`);
    
    const response = await fetch(postUrl, {
      headers: {
        'User-Agent': 'AIOgames-Tracker/1.0'
      }
    });
    
    if (!response.ok) {
      logger.warn(`Failed to fetch post details: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
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

// Enhanced version extraction with comprehensive piracy release support
function extractVersionInfo(title: string): VersionInfo {
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

// Proper semantic version comparison: returns 1 if a > b, -1 if a < b, 0 if equal
function compareSemanticVersions(a: string, b: string): number {
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

type VersionScheme = 'semver' | 'build' | 'date' | 'unknown';

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

function compareVersions(oldVersion: VersionInfo, newVersion: VersionInfo): { isNewer: boolean; changeType: string; significance: number; shouldWaitForRegular?: boolean; suspiciousVersion?: { isSuspicious: boolean; reason?: string }; skipDueToHierarchy?: boolean } {
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
    versionDate: resolved.resolvedFromDate ? undefined : versionInfo.versionDate,
    hasRegularVersion: resolved.version ? /^\d+\.\d+/.test(resolved.version) : versionInfo.hasRegularVersion,
    fullVersionString: `${resolved.version || versionInfo.version}${resolved.build || versionInfo.build ? ` Build ${resolved.build || versionInfo.build}` : ''}${versionInfo.releaseType ? ` ${versionInfo.releaseType}` : ''}`,
  };
}

// Main update check using recent feed approach
export async function POST(request: Request) {
  const startTime = Date.now();
  logger.info('Starting update check using recent feed');
  
  try {
    // Check if this is an internal scheduler call
    const headers = request.headers;
    const schedulerUserId = headers.get('User-Id');
    
    let user: { id: string; email: string; name: string } | null = null;
    
    if (schedulerUserId) {
      // Internal call from scheduler - use provided user ID
      user = { id: schedulerUserId, email: '', name: 'Scheduler' };
  logger.debug(`Scheduled update check for user: ${schedulerUserId}`);
    } else {
      // Regular API call - get current user
      user = await getCurrentUser();
      if (!user) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
  logger.debug(`Manual update check for user: ${user.id}`);
    }

    await connectDB();

    // Get the full user object with preferences for AI detection settings
    const { User } = await import('../../../../lib/models');
    const fullUser = await User.findById(user.id);
    if (!fullUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get AI detection preferences
    const aiPreferences = fullUser.preferences?.aiDetection || {
      enabled: true,
      autoApprovalThreshold: 0.8,
      fallbackToRegex: true,
      debugLogging: false
    };

    // Get sequel detection preferences
    const sequelPreferences = fullUser.preferences?.sequelDetection || {
      enabled: true,
      sensitivity: 'moderate',
      notifyImmediately: true
    };

    // Get release group preferences
    const releaseGroupPreferences = fullUser.preferences?.releaseGroups || {
      prioritize0xdeadcode: false,
      prefer0xdeadcodeForOnlineFixes: true,
      avoidRepacks: false
    };

    logger.debug(`AI Detection preferences: enabled=${aiPreferences.enabled}, threshold=${aiPreferences.autoApprovalThreshold}`);
    logger.debug(`Sequel Detection preferences: enabled=${sequelPreferences.enabled}, sensitivity=${sequelPreferences.sensitivity}`);
    logger.debug(`Release Group preferences: prioritize0xdeadcode=${releaseGroupPreferences.prioritize0xdeadcode}, prefer0xdeadcodeForOnlineFixes=${releaseGroupPreferences.prefer0xdeadcodeForOnlineFixes}, avoidRepacks=${releaseGroupPreferences.avoidRepacks}`);

    // Get all active tracked games for this user
    const trackedGames = await TrackedGame.find({ 
      userId: user.id,
      isActive: true 
    });
    
  logger.info(`Found ${trackedGames.length} games to check for user ${user.id}`);
    
    if (trackedGames.length === 0) {
      return NextResponse.json({ 
        message: 'No games to check',
        checked: 0,
        updatesFound: 0,
        sequelsFound: 0
      });
    }

    // First clear the cache to get fresh results
  logger.debug('Clearing game API cache before fetch');
    const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
    
    try {
      const clearCacheResponse = await fetch(`${baseUrl}/clearcache`, {
        method: 'POST'
      });
      if (clearCacheResponse.ok) {
  logger.debug('Cache cleared successfully');
      } else {
  logger.warn('Cache clear failed, continuing with potentially cached results');
      }
    } catch (cacheError) {
  logger.warn('Cache clear error, continuing:', cacheError instanceof Error ? cacheError.message : 'Unknown error');
    }

    // Fetch recent games from the API (same as homepage)
  logger.info('Fetching recent games from feed');
    let recentGames: GameSearchResult[] = [];
    
    try {
      const recentResponse = await fetch(`${baseUrl}/recent?limit=100`);
      if (recentResponse.ok) {
        const recentData = await recentResponse.json();
        recentGames = recentData.results || [];
        
        // Filter out repacks if user preference is set
        if (releaseGroupPreferences.avoidRepacks) {
          const originalCount = recentGames.length;
          recentGames = recentGames.filter((game: GameSearchResult) => {
            const title = game.title.toLowerCase();
            return !title.includes('repack') && !title.includes('-repack');
          });
          const filtered = originalCount - recentGames.length;
          if (filtered > 0) {
            logger.info(`Filtered out ${filtered} repack(s) based on user preference`);
          }
        }
        
        logger.info(`Retrieved ${recentGames.length} recent games from feed`);
      } else {
        throw new Error(`Recent API failed: ${recentResponse.status}`);
      }
    } catch (fetchError) {
  logger.error('Failed to fetch recent games:', fetchError);
      return NextResponse.json({
        error: 'Failed to fetch recent games from API',
        checked: 0,
        updatesFound: 0,
        sequelsFound: 0,
        errors: 1
      });
    }

    let updatesFound = 0;
    let sequelsFound = 0;
    let errors = 0;

    // Check each tracked game against the recent feed
    for (const game of trackedGames) {
      const gameStartTime = Date.now();
  logger.debug(`Checking: ${game.title}`);

      try {
        // --- Robust filter gate matching ---
        // 1. Cleaned name
        // 2. Steam enhanced name (if available)
        // 3. Original title
        const cleanTitle = cleanGameTitle(game.title);
        const steamName = game.steamName ? game.steamName.trim() : null;
        const originalTitle = game.originalTitle ? game.originalTitle.trim() : null;

        // Find all potential matches for each gate
        const gates = [
          { label: 'cleaned', value: cleanTitle },
          ...(steamName ? [{ label: 'steam', value: steamName }] : []),
          ...(originalTitle ? [{ label: 'original', value: originalTitle }] : [])
        ];

        const potentialMatches: EnhancedMatch[] = [];
        let bestMatch: GameSearchResult | null = null;
        let bestSimilarity = 0;
        let bestGate = '';

        // First look for direct matches
        const gateChecks = gates;
        for (const gate of gateChecks) {
          for (const recentGame of recentGames) {
            // Skip if this is the exact same post we're already tracking
            if (recentGame.link === game.gameLink) {
              continue;
            }
            
            const decodedTitle = decodeHtmlEntities(recentGame.title);
            const similarity = calculateGameSimilarity(gate.value, decodedTitle);
            if (similarity >= 0.8) {
              // If 100% similarity, the title is identical to what we're tracking.
              // Only consider it if it has a version/build/update pattern that differs.
              if (similarity === 1.0) {
                const hasVersionPattern = /\b(v?\d+\.\d+|build\s*\d+|update\s*\d+|patch\s*\d+|\d{4}[-.]\d{2}[-.]\d{2})\b/i.test(decodedTitle);
                const hasUpdateKeywords = /\b(update|patch|hotfix|fixed|repack|latest|improved|enhanced)\b/i.test(decodedTitle);
                if (!hasVersionPattern && !hasUpdateKeywords) {
                  logger.debug(`⏩ Skipping 100% similarity match with no version/update pattern: "${decodedTitle}"`);
                  continue;
                }
              }
              
              const versionInfo = extractVersionInfo(decodedTitle);
              potentialMatches.push({ game: recentGame, similarity, versionInfo, gate: gate.label });
            }
          }
          // If we found matches in this gate, stop and use only these
          if (potentialMatches.length > 0) {
            bestGate = gate.label;
            break;
          }
        }

        // Only check for sequels if we found NO direct matches AND sequel detection is enabled
        if (potentialMatches.length === 0 && sequelPreferences.enabled) {
          logger.debug(`No direct matches found for "${game.title}", checking for sequels (enabled: ${sequelPreferences.enabled})`);
          
          // Adjust similarity threshold based on user sensitivity
          let minSimilarity = 0.5;
          let maxSimilarity = 0.8;
          
          switch (sequelPreferences.sensitivity) {
            case 'strict':
              minSimilarity = 0.65;
              maxSimilarity = 0.8;
              break;
            case 'moderate':
              minSimilarity = 0.5;
              maxSimilarity = 0.8;
              break;
            case 'loose':
              minSimilarity = 0.4;
              maxSimilarity = 0.85;
              break;
          }
          
          logger.debug(`Checking for sequels with ${sequelPreferences.sensitivity} sensitivity (similarity: ${minSimilarity}-${maxSimilarity})`);
          
          for (const gate of gateChecks) {
            for (const recentGame of recentGames) {
              const decodedTitle = decodeHtmlEntities(recentGame.title);
              const similarity = calculateGameSimilarity(gate.value, decodedTitle);
              
              // Check for sequels with user-defined sensitivity only when no direct matches found
              if (similarity >= minSimilarity && similarity < maxSimilarity && gate.label === 'cleaned') {
                const sequelResult = detectSequel(game.title, decodedTitle);
                if (sequelResult && sequelResult.isSequel) {
                  const cleanedSequelTitle = cleanGameTitle(decodedTitle);
                  
                  // Check if this sequel is already being tracked by this user
                  const existingTrackedSequel = await TrackedGame.findOne({
                    userId: game.userId,
                    isActive: true,
                    $or: [
                      { title: cleanedSequelTitle },
                      { originalTitle: decodedTitle },
                      { gameLink: recentGame.link }
                    ]
                  });
                  
                  if (existingTrackedSequel) {
                    // Sequel is already tracked - treat this as a potential update to the existing sequel
                    logger.info(`Found potential update for existing sequel ${existingTrackedSequel.title}: ${decodedTitle}`);
                    
                    // Check if this is actually a newer version of the tracked sequel
                    const existingVersionInfo = extractVersionInfo(existingTrackedSequel.originalTitle || existingTrackedSequel.title);
                    const newVersionInfo = extractVersionInfo(decodedTitle);
                    const comparison = compareVersions(existingVersionInfo, newVersionInfo);
                    
                    if (comparison.isNewer) {
                      // Update the existing sequel with the new version
                      const versionString = newVersionInfo.fullVersionString || newVersionInfo.version || 'Unknown Version';
                      
                      await TrackedGame.findByIdAndUpdate(existingTrackedSequel._id, {
                        title: cleanedSequelTitle,
                        originalTitle: decodedTitle,
                        lastKnownVersion: versionString,
                        lastVersionDate: recentGame.date || new Date().toISOString(),
                        lastPubTimestamp: parsePubTimestamp(recentGame.date) || Date.now(),
                        lastChecked: new Date(),
                        dateAdded: new Date(), // Move game to top when sequel update is detected
                        gameLink: recentGame.link,
                        hasNewUpdate: true,
                        newUpdateSeen: false,
                        $push: {
                          updateHistory: {
                            version: versionString,
                            changeType: 'sequel_update',
                            significance: comparison.significance,
                            dateFound: new Date(),
                            gameLink: recentGame.link,
                            downloadLinks: recentGame.downloadLinks || []
                          }
                        }
                      });
                      
                      // Send notification for the sequel update if immediate notifications are enabled
                      if (sequelPreferences.notifyImmediately) {
                        try {
                          // Fetch download links for the sequel
                          const downloadLinks = await fetchDownloadLinks(recentGame);
                          
                          const notificationData = createUpdateNotificationData({
                            gameTitle: cleanedSequelTitle,
                            version: versionString,
                            gameLink: recentGame.link,
                            imageUrl: recentGame.image,
                            updateType: 'update',
                            downloadLinks: downloadLinks
                          });
                          await sendUpdateNotification(game.userId.toString(), notificationData);
                          logger.info(`Sequel update notification sent: ${cleanedSequelTitle} -> ${versionString}`);
                        } catch (notificationError) {
                          logger.error('Failed to send sequel update notification:', notificationError);
                        }
                      } else {
                        logger.info(`Sequel update found but immediate notifications disabled: ${cleanedSequelTitle} -> ${versionString}`);
                      }
                      
                      updatesFound++;
                    }
                  } else {
                    // Sequel is not tracked - create a new tracked game for it
                    logger.info(`Creating new tracked game for sequel: ${game.title} -> ${cleanedSequelTitle}`);
                    
                    const versionInfo = extractVersionInfo(decodedTitle);
                    const versionString = versionInfo.fullVersionString || versionInfo.version || 'Initial Version';
                    
                    const newSequelGame = new TrackedGame({
                      userId: game.userId,
                      gameId: recentGame.id || `sequel-${Date.now()}`,
                      title: cleanedSequelTitle,
                      originalTitle: decodedTitle,
                      source: recentGame.source || 'Auto-detected Sequel',
                      image: recentGame.image || '',
                      description: recentGame.description || `Sequel to ${game.title}`,
                      gameLink: recentGame.link,
                      lastKnownVersion: versionString,
                      lastVersionDate: recentGame.date || new Date().toISOString(),
                      lastPubTimestamp: parsePubTimestamp(recentGame.date) || Date.now(),
                      dateAdded: new Date(),
                      lastChecked: new Date(),
                      notificationsEnabled: true,
                      checkFrequency: 'daily',
                      isActive: true,
                      hasNewUpdate: false,
                      newUpdateSeen: true, // Mark as seen since it's auto-detected
                      sequelSource: {
                        originalGameId: game._id,
                        originalGameTitle: game.title,
                        detectionMethod: 'automatic',
                        similarity: similarity,
                        sequelType: sequelResult.sequelType
                      }
                    });
                    
                    await newSequelGame.save();
                    
                    // Send notification for the new sequel if immediate notifications are enabled
                    if (sequelPreferences.notifyImmediately) {
                      try {
                        const notificationData = createUpdateNotificationData({
                          gameTitle: `${game.title} (Sequel: ${cleanedSequelTitle})`,
                          version: versionString,
                          gameLink: recentGame.link,
                          imageUrl: recentGame.image,
                          updateType: 'sequel'
                        });
                        await sendUpdateNotification(game.userId.toString(), notificationData);
                        logger.info(`New sequel tracking notification sent: ${cleanedSequelTitle}`);
                      } catch (notificationError) {
                        logger.error('Failed to send new sequel notification:', notificationError);
                      }
                    } else {
                      logger.info(`New sequel detected but immediate notifications disabled: ${cleanedSequelTitle}`);
                    }
                    
                    sequelsFound++;
                  }
                }
              }
            }
          }
        } else if (potentialMatches.length === 0 && !sequelPreferences.enabled) {
          logger.debug(`No direct matches found for "${game.title}" and sequel detection is disabled`);
        }

        // Now select the best match with AI-enhanced detection
        logger.debug(`Found ${potentialMatches.length} potential matches for "${game.title}" (gate: ${bestGate})`);
        
        let selectedMatch: EnhancedMatch | null = null;

        if (potentialMatches.length > 0) {
          const sortedMatches: EnhancedMatch[] = [...potentialMatches];
          const hasVerifiedVersion = game.versionNumberVerified && game.currentVersionNumber;
          const hasVerifiedBuild = game.buildNumberVerified && game.currentBuildNumber;
          logger.debug(`Game verification status: Version=${hasVerifiedVersion ? game.currentVersionNumber : 'No'}, Build=${hasVerifiedBuild ? game.currentBuildNumber : 'No'}`);
          
          // Score all matches with regex-based detection
          for (const match of sortedMatches) {
            let regexScore = match.similarity;
            
            const updateKeywords = [
              'update', 'patch', 'hotfix', 'build', 'version', 'v\\d', 'rev', 'fixed',
              'bugfix', 'new version', 'latest', 'improved', 'enhanced', 'repack',
              'director.*cut', 'goty', 'complete.*edition', 'final.*cut'
            ];
            
            const versionPatterns = [
              /v\d+\.\d+\.\d+/i, /\d+\.\d+\.\d+/, /build\s*\d+/i, /patch\s*\d+/i,
              /update\s*\d+/i, /rev\s*\d+/i, /r\d+/i, /v\d{8}/i, /\d{4}[-\.]\d{2}[-\.]\d{2}/
            ];
            
            const titleLower = match.game.title.toLowerCase();
            const gameTitle = game.title.toLowerCase();
            
            for (const keyword of updateKeywords) {
              const regex = new RegExp(keyword, 'i');
              if (regex.test(titleLower) && !regex.test(gameTitle)) {
                regexScore += 0.1;
              }
            }
            
            for (const pattern of versionPatterns) {
              if (pattern.test(match.game.title)) {
                regexScore += 0.15;
              }
            }
            
            match.enhancedScore = Math.min(regexScore, 1.0);
          }

          // Sort by enhanced scores
          sortedMatches.sort((a, b) => {
            // First priority: 0xdeadcode releases if user prefers them
            if (releaseGroupPreferences.prioritize0xdeadcode) {
              const aIs0xdeadcode = is0xdeadcodeRelease(a.game.title);
              const bIs0xdeadcode = is0xdeadcodeRelease(b.game.title);
              
              if (aIs0xdeadcode && !bIs0xdeadcode) return -1;
              if (!aIs0xdeadcode && bIs0xdeadcode) return 1;
            }
            
            const aScore = a.enhancedScore || a.similarity;
            const bScore = b.enhancedScore || b.similarity;
            
            // Primary sort by enhanced score
            if (Math.abs(bScore - aScore) > 0.05) return bScore - aScore;
            
            // Secondary sort by verification-specific criteria
            if (hasVerifiedVersion && hasVerifiedBuild) {
              const vCmp = compareSemanticVersions(b.versionInfo.version || '0', a.versionInfo.version || '0');
              if (vCmp !== 0) return vCmp;
              const aBuild = parseInt(a.versionInfo.build || '0');
              const bBuild = parseInt(b.versionInfo.build || '0');
              return bBuild - aBuild;
            } else if (hasVerifiedVersion) {
              return compareSemanticVersions(b.versionInfo.version || '0', a.versionInfo.version || '0');
            } else if (hasVerifiedBuild) {
              const aBuild = parseInt(a.versionInfo.build || '0');
              const bBuild = parseInt(b.versionInfo.build || '0');
              return bBuild - aBuild;
            }
            
            // Tertiary sort by original similarity
            return b.similarity - a.similarity;
          });

          bestMatch = sortedMatches[0]?.game || null;
          bestSimilarity = sortedMatches[0]?.similarity || 0;
          selectedMatch = sortedMatches[0] || null;
          
          if (bestMatch) {
            logger.debug(`Selected best match: "${bestMatch.title}" (similarity: ${bestSimilarity.toFixed(2)}, enhanced: ${(selectedMatch?.enhancedScore || 0).toFixed(2)}, gate: ${bestGate})`);
          }
        }
        
        // Process the selected best match
        if (bestMatch) {
          const decodedTitle = decodeHtmlEntities(bestMatch.title);
          
          // Get verification status for this game
          const hasVerifiedVersion = game.versionNumberVerified && game.currentVersionNumber;
          const hasVerifiedBuild = game.buildNumberVerified && game.currentBuildNumber;
          
          // Get current version info based on verification status
          let currentVersionInfo = null;
          
          if (hasVerifiedVersion && game.currentVersionNumber) {
            logger.debug(`Using verified version number: ${game.currentVersionNumber}`);
            currentVersionInfo = extractVersionInfo(game.currentVersionNumber);
          } else if (hasVerifiedBuild && game.currentBuildNumber) {
            logger.debug(`Using verified build number: ${game.currentBuildNumber}`);
            currentVersionInfo = { 
              version: '', 
              build: game.currentBuildNumber, 
              releaseType: '', 
              updateType: '', 
              baseTitle: '', 
              fullVersionString: '', 
              confidence: 1.0, 
              needsUserConfirmation: false,
              isDateVersion: false,
              versionDate: undefined,
              hasRegularVersion: false
            };
          } else {
            // Fall back to extracting from titles
            const titleSources = [
              game.originalTitle,
              game.lastKnownVersion,
              game.title
            ].filter(Boolean);

            for (const sourceTitle of titleSources) {
              const info = extractVersionInfo(sourceTitle);
              if (info.version || info.build) {
                currentVersionInfo = info;
                break;
              }
            }
            
            if (!currentVersionInfo) {
              currentVersionInfo = extractVersionInfo(game.title);
            }
          }

          let newVersionInfo = extractVersionInfo(decodedTitle);

          if (game.steamAppId) {
            try {
              currentVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, currentVersionInfo);
              newVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, newVersionInfo);
            } catch (e) {
              logger.debug('SteamDB enrichment skipped:', e instanceof Error ? e.message : 'unknown');
            }
          }
          
          // Enhanced comparison that respects verification preferences
          let isActuallyNewer = false;
          let comparisonReason = '';
          let comparison: { isNewer: boolean; changeType: string; significance: number; shouldWaitForRegular?: boolean; suspiciousVersion?: { isSuspicious: boolean; reason?: string }; skipDueToHierarchy?: boolean } | undefined;
          const currentScheme = detectVersionScheme(currentVersionInfo);
          const newScheme = detectVersionScheme(newVersionInfo);
          const schemesMismatchOrUnknown = currentScheme !== newScheme || currentScheme === 'unknown' || newScheme === 'unknown';
          let currentPubTimestamp = typeof game.lastPubTimestamp === 'number' ? game.lastPubTimestamp : 0;

          if (game.steamAppId && (game.currentBuildNumber || currentVersionInfo.build)) {
            const currentBuildForTimestamp = game.currentBuildNumber || currentVersionInfo.build;
            if (currentBuildForTimestamp) {
              const resolvedCurrentPubTs = await resolvePubTimestampFromBuild(game.steamAppId, currentBuildForTimestamp);
              if (typeof resolvedCurrentPubTs === 'number' && resolvedCurrentPubTs > 0) {
                currentPubTimestamp = resolvedCurrentPubTs;
              }
            }
          }

          if (currentPubTimestamp <= 0 && game.steamAppId && (game.currentVersionNumber || currentVersionInfo.version)) {
            const currentVersionForTimestamp = game.currentVersionNumber || currentVersionInfo.version;
            if (currentVersionForTimestamp) {
              const resolvedCurrentPubTsFromVersion = await resolvePubTimestampFromVersion(game.steamAppId, currentVersionForTimestamp);
              if (typeof resolvedCurrentPubTsFromVersion === 'number' && resolvedCurrentPubTsFromVersion > 0) {
                currentPubTimestamp = resolvedCurrentPubTsFromVersion;
              }
            }
          }

          if (currentPubTimestamp <= 0) {
            currentPubTimestamp = parsePubTimestamp(game.lastVersionDate);
          }
          let newPubTimestamp = parsePubTimestamp(bestMatch.date);

          if (newPubTimestamp <= 0 && game.steamAppId && newVersionInfo.build) {
            const resolvedPubTs = await resolvePubTimestampFromBuild(game.steamAppId, newVersionInfo.build);
            if (typeof resolvedPubTs === 'number' && resolvedPubTs > 0) {
              newPubTimestamp = resolvedPubTs;
              logger.debug(`🕒 Resolved missing pub timestamp from SteamDB build ${newVersionInfo.build}: ${newPubTimestamp}`);
            }
          }

          if (newPubTimestamp <= 0 && game.steamAppId && newVersionInfo.version) {
            const resolvedPubTsFromVersion = await resolvePubTimestampFromVersion(game.steamAppId, newVersionInfo.version);
            if (typeof resolvedPubTsFromVersion === 'number' && resolvedPubTsFromVersion > 0) {
              newPubTimestamp = resolvedPubTsFromVersion;
              logger.debug(`🕒 Resolved missing pub timestamp from SteamDB version ${newVersionInfo.version}: ${newPubTimestamp}`);
            }
          }

          const canFallbackToPubTimestamp = currentPubTimestamp > 0 && newPubTimestamp > 0;
          const pubTimestampDelta = canFallbackToPubTimestamp ? (newPubTimestamp - currentPubTimestamp) : 0;
          const shouldUseStringFallback = !canFallbackToPubTimestamp || pubTimestampDelta === 0;
          
          // More flexible update detection - don't require version if we have other indicators
          const hasVersionInfo = newVersionInfo.version || newVersionInfo.build;
          const hasUpdateKeywords = /\b(update|patch|hotfix|new|latest|improved|fixed|enhanced)\b/i.test(decodedTitle);
          const isDifferentReleaseGroup = extractReleaseGroup(decodedTitle) !== extractReleaseGroup(game.title);
          const is0xdeadcodeUpdate = is0xdeadcodeRelease(decodedTitle);
          
          if (!hasVersionInfo && !hasUpdateKeywords && !isDifferentReleaseGroup && !is0xdeadcodeUpdate) {
            logger.debug(`Skipping post "${decodedTitle}" - no version info or update indicators`);
            continue;
          }
          
          if (canFallbackToPubTimestamp && pubTimestampDelta !== 0) {
            isActuallyNewer = pubTimestampDelta > 0;
            comparisonReason = pubTimestampDelta > 0
              ? `Publication timestamp precedence: ${currentPubTimestamp} → ${newPubTimestamp}`
              : `Publication timestamp precedence (older): ${currentPubTimestamp} → ${newPubTimestamp}`;
            logger.debug(`🕒 Using publication timestamp precedence for update decision: ${comparisonReason}`);
          }

          // Only use string/version comparison if pubdate could not decide.
          if (shouldUseStringFallback) {
            // Special handling for 0xdeadcode releases (online fixes)
            if (is0xdeadcodeUpdate && releaseGroupPreferences.prefer0xdeadcodeForOnlineFixes) {
              isActuallyNewer = true;
              comparisonReason = '0xdeadcode online fix release (user prefers 0xdeadcode)';
              logger.info(`0xdeadcode release detected with user preference: ${decodedTitle}`);
            } else if (is0xdeadcodeUpdate) {
              isActuallyNewer = true;
              comparisonReason = '0xdeadcode online fix release';
              logger.info(`0xdeadcode release detected: ${decodedTitle}`);
            } else if ((hasVerifiedVersion || hasVerifiedBuild) && hasVersionInfo) {
            const hasComparableVersion = !!(newVersionInfo.version && currentVersionInfo.version);
            const currentBuild = parseInt(currentVersionInfo.build || '0');
            const newBuild = parseInt(newVersionInfo.build || '0');
            const canCompareBuilds = !isNaN(currentBuild) && !isNaN(newBuild) && currentBuild > 0 && newBuild > 0;

            if (!schemesMismatchOrUnknown) {
              const versionCmp = hasComparableVersion
                ? compareSemanticVersions(newVersionInfo.version, currentVersionInfo.version)
                : 0;

              if ((hasComparableVersion && versionCmp > 0) ||
                  (hasComparableVersion && canCompareBuilds && versionCmp === 0 && newBuild > currentBuild) ||
                  (!hasComparableVersion && canCompareBuilds && newBuild > currentBuild)) {
                isActuallyNewer = true;
                comparisonReason = `Version/Build: ${currentVersionInfo.version || '0'}/${currentVersionInfo.build || '0'} → ${newVersionInfo.version || '0'}/${newVersionInfo.build || '0'}`;
              }
            } else if (canFallbackToPubTimestamp && newPubTimestamp > currentPubTimestamp) {
              isActuallyNewer = true;
              comparisonReason = `Publication timestamp fallback: ${currentPubTimestamp} → ${newPubTimestamp} (scheme mismatch ${currentScheme} vs ${newScheme})`;
            }
          } else if (hasVerifiedVersion) {
            // Only compare versions
            if (!schemesMismatchOrUnknown) {
              const versionCmp = compareSemanticVersions(newVersionInfo.version || '0', currentVersionInfo.version || game.currentVersionNumber || '0');

              if (versionCmp > 0) {
                isActuallyNewer = true;
                comparisonReason = `Version: ${currentVersionInfo.version || game.currentVersionNumber || '0'} → ${newVersionInfo.version || '0'}`;
              }
            } else if (canFallbackToPubTimestamp && newPubTimestamp > currentPubTimestamp) {
              isActuallyNewer = true;
              comparisonReason = `Publication timestamp fallback: ${currentPubTimestamp} → ${newPubTimestamp} (scheme mismatch ${currentScheme} vs ${newScheme})`;
            }
            } else if (hasVerifiedBuild) {
              // Compare builds, but also check versions if available
              const currentBuild = parseInt(game.currentBuildNumber || '0');
              const newBuild = parseInt(newVersionInfo.build || '0');
              
              if (newBuild > currentBuild) {
                isActuallyNewer = true;
                comparisonReason = `Build: ${currentBuild} → ${newBuild}`;
              } else if (newVersionInfo.version && currentVersionInfo.version && !schemesMismatchOrUnknown) {
                // Fall back to version comparison if builds can't determine
                const versionCmp = compareSemanticVersions(newVersionInfo.version, currentVersionInfo.version);
                if (versionCmp > 0) {
                  isActuallyNewer = true;
                  comparisonReason = `Version (build unavailable): ${currentVersionInfo.version} → ${newVersionInfo.version}`;
                }
              } else if (canFallbackToPubTimestamp && newPubTimestamp > currentPubTimestamp) {
                isActuallyNewer = true;
                comparisonReason = `Publication timestamp fallback: ${currentPubTimestamp} → ${newPubTimestamp}`;
              }
            } else {
              // Enhanced comparison with date-version awareness and release hierarchy
              if (hasVersionInfo) {
                comparison = compareVersions(currentVersionInfo, newVersionInfo);
              
                // Check if update should be skipped due to release hierarchy
                if (comparison.skipDueToHierarchy) {
                  logger.info(`⏭️ Skipping update due to release hierarchy: ${decodedTitle}`);
                  continue; // Skip this update entirely
                }
              
                // Handle date-version preference logic
                if (comparison.shouldWaitForRegular) {
                  logger.info(`Date-based version found but waiting for regular version: ${decodedTitle} (found ${newVersionInfo.version})`);
                  continue; // Skip this update for now, wait for a regular version
                }
              
                // Check if this is a date-based version that we should wait for
                if (newVersionInfo.isDateVersion && newVersionInfo.versionDate) {
                  const daysSinceVersion = Math.floor((Date.now() - newVersionInfo.versionDate.getTime()) / (1000 * 60 * 60 * 24));
                
                  // If it's a very recent date version (< 2 days), check if there are newer posts with regular versions
                  if (daysSinceVersion < 2) {
                    // Look for newer posts in the recent games list that might have regular versions
                    const newerPostsWithRegularVersions = recentGames.filter(recentGame => {
                      if (!recentGame.date) return false;
                      const postDate = new Date(recentGame.date);
                      const gamePostDate = bestMatch.date ? new Date(bestMatch.date) : new Date();
                    
                      // Check if this post is newer than our current candidate
                      if (postDate <= gamePostDate) return false;
                    
                      // Check if this newer post has a regular version and similar title
                      const newerTitle = decodeHtmlEntities(recentGame.title);
                      const similarity = calculateGameSimilarity(cleanTitle, newerTitle);
                      if (similarity < 0.8) return false;
                    
                      const newerVersionInfo = extractVersionInfo(newerTitle);
                      return newerVersionInfo.hasRegularVersion;
                    });
                  
                    if (newerPostsWithRegularVersions.length > 0) {
                      logger.info(`Found newer post with regular version, skipping date version: ${decodedTitle}`);
                      continue; // Skip the date version since we have a newer regular version
                    }
                  }
                }
              
                // Handle date-to-regular transitions that need verification
                if (comparison.changeType === 'date_to_regular_needs_verification') {
                  // Current game has date version, new post has regular version
                  // We need to verify if the regular version is actually newer by checking post dates
                  if (canFallbackToPubTimestamp) {
                    if (newPubTimestamp > currentPubTimestamp) {
                      isActuallyNewer = true;
                      comparisonReason = `Regular version from newer post timestamp: ${currentPubTimestamp} → ${newPubTimestamp} (${currentVersionInfo.version} → ${newVersionInfo.version})`;
                      logger.info(`Date-to-regular version update verified by post date: ${decodedTitle}`);
                    } else {
                      // Post date is older or same, so the regular version might be older
                      logger.info(`Regular version from older post timestamp, skipping: ${decodedTitle} (${newPubTimestamp} <= ${currentPubTimestamp})`);
                      // Continue to check if we can verify via SteamDB
                    }
                  } else {
                    // No post dates available, fall back to treating it as potentially newer
                    // but with lower confidence (requires user confirmation)
                    isActuallyNewer = true;
                    comparisonReason = `Regular version found (date verification unavailable): ${currentVersionInfo.version} → ${newVersionInfo.version}`;
                    logger.info(`Date-to-regular version update (unverified): ${decodedTitle}`);
                  }
                }
              
                // If we have a date-based version that's older than 2 days, check post dates as fallback
                else if (newVersionInfo.isDateVersion && !comparison.isNewer) {
                  // Fallback to post date comparison for date-based versions
                  if (canFallbackToPubTimestamp && newPubTimestamp > currentPubTimestamp) {
                    isActuallyNewer = true;
                    comparisonReason = `Newer post timestamp: ${currentPubTimestamp} → ${newPubTimestamp} (date-based version)`;
                    logger.info(`Date-based version update by post date: ${decodedTitle}`);
                  }
                } else if (schemesMismatchOrUnknown) {
                  // Schemes are incompatible — skip string comparison and rely solely on pub_timestamp
                  if (canFallbackToPubTimestamp && newPubTimestamp > currentPubTimestamp) {
                    isActuallyNewer = true;
                    comparisonReason = `Publication timestamp fallback: ${currentPubTimestamp} → ${newPubTimestamp} (scheme mismatch ${currentScheme} vs ${newScheme})`;
                  }
                } else {
                  isActuallyNewer = comparison.isNewer && comparison.significance >= 1;
                  comparisonReason = `Enhanced comparison: ${comparison.changeType} (significance: ${comparison.significance})`;
                }
              } else if (hasUpdateKeywords || isDifferentReleaseGroup) {
                // Accept updates based on keywords or different release groups
                isActuallyNewer = true;
                comparisonReason = hasUpdateKeywords ? 'Update keywords detected' : 'Different release group';
              }
            }
          }
          
          // Check if it's different content (different link) or actually newer
          const isDifferentLink = game.gameLink !== bestMatch.link;
          
          // Only treat a different link as an update if the version is actually newer
          // This prevents the same version from another site being flagged as an update,
          // except when user prefers Online-Fix/0xdeadcode and the new post is one of those.
          let isVersionSame = !!(
            currentVersionInfo &&
            ((newVersionInfo.version && currentVersionInfo.version && newVersionInfo.version === currentVersionInfo.version) ||
             (newVersionInfo.build && currentVersionInfo.build && newVersionInfo.build === currentVersionInfo.build)) &&
            (!newVersionInfo.build || !currentVersionInfo.build || newVersionInfo.build === currentVersionInfo.build)
          );

          // --- Online-Fix/0xdeadcode preference override ---
          const userPrefersOnlineFix = fullUser?.preferences?.releaseGroups?.prefer0xdeadcodeForOnlineFixes;
          const isNewOnlineFix = isOnlineFixRelease(decodedTitle) || is0xdeadcodeRelease(decodedTitle);
          if (
            isVersionSame &&
            isDifferentLink &&
            userPrefersOnlineFix &&
            isNewOnlineFix
          ) {
            logger.info('User prefers Online-Fix/0xdeadcode: overriding isVersionSame to allow update');
            isVersionSame = false;
          }

          logger.debug(`Update analysis: Different link=${isDifferentLink}, Newer=${isActuallyNewer}, VersionSame=${isVersionSame}, Reason=${comparisonReason}`);

          if (isActuallyNewer || (isDifferentLink && !isVersionSame)) {
            logger.info(`Update found: ${decodedTitle} (different link: ${isDifferentLink}, newer: ${isActuallyNewer})`);
            
            // Check if we already have this update (use fresh DB query to avoid race conditions)
            const freshGame = await TrackedGame.findById(game._id).lean() as {
              updateHistory?: Array<{ version?: string; build?: string; gameLink: string; notificationSent?: boolean }>;
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

            const existingUpdate = freshGame?.updateHistory?.find((update) =>
              update.gameLink === bestMatch.link && isSameSignature(update.build, update.version)
            );
            
            // If update exists and notification was already sent, skip it
            if (existingUpdate && existingUpdate.notificationSent) {
              logger.info(`Skipping update that already had notification sent: ${bestMatch.link}`);
            } else if (existingUpdate) {
              logger.info(`Skipping duplicate update (already in updateHistory): ${bestMatch.link}`);
            } else {
              // Create version string
              let versionString = decodedTitle;
              if (newVersionInfo.version) {
                versionString = `v${newVersionInfo.version}`;
                if (newVersionInfo.build) versionString += ` Build ${newVersionInfo.build}`;
                if (newVersionInfo.releaseType) versionString += ` ${newVersionInfo.releaseType}`;
              }
              
              // Check for suspicious version patterns - block auto-approval if suspicious
              const hasSuspiciousVersion = comparison?.suspiciousVersion?.isSuspicious || false;

              // Auto-approve if:
              // - We have verified info and it's clearly higher
              // - Similarity is 100% and significant
              // - Publication timestamp precedence confirms newer
              // - Version/build comparison is clearly newer
              // Suspicious versions are never auto-approved.
              const pubTimestampConfirmed =
                comparisonReason.startsWith('Publication timestamp precedence') ||
                comparisonReason.startsWith('Publication timestamp fallback') ||
                comparisonReason.startsWith('Newer post timestamp');

              const shouldAutoApprove = !hasSuspiciousVersion && (
                ((hasVerifiedVersion || hasVerifiedBuild) && isActuallyNewer && bestSimilarity >= 0.85) ||
                (bestSimilarity === 1.0 && isActuallyNewer) ||
                (pubTimestampConfirmed && isActuallyNewer && bestSimilarity >= 0.8) ||
                // Trust the version/build comparison directly when it has high enough significance
                // (e.g. build number higher, suffix patch like v0.4.3f → v0.4.3g, minor/major bump)
                (comparison?.isNewer && !comparison?.suspiciousVersion?.isSuspicious &&
                  (comparison?.significance ?? 0) >= 2 && isActuallyNewer && bestSimilarity >= 0.85)
              );

              // Detect if this is an Online-Fix release
              const isOnlineFix = isOnlineFixRelease(decodedTitle);
              if (isOnlineFix) {
                logger.info(`🌐 Detected Online-Fix release: ${decodedTitle}`);
              }

              if (shouldAutoApprove) {
                // Auto-approve high confidence updates
                const approvedUpdate = {
                  version: versionString,
                  build: newVersionInfo.build || '',
                  releaseType: newVersionInfo.releaseType || '',
                  updateType: newVersionInfo.updateType || '',
                  changeType: 'auto_approved',
                  significance: 5,
                  dateFound: new Date(),
                  gameLink: bestMatch.link,
                  previousVersion: game.lastKnownVersion || game.title,
                  downloadLinks: bestMatch.downloadLinks || [],
                  autoApproved: true,
                  verificationReason: comparisonReason,
                  isOnlineFix: isOnlineFix,
                };

                const updateFields: Record<string, unknown> = {
                  $push: { updateHistory: approvedUpdate },
                  lastKnownVersion: versionString,
                  lastVersionDate: bestMatch.date || new Date().toISOString(),
                  lastPubTimestamp: parsePubTimestamp(bestMatch.date) || Date.now(),
                  lastChecked: new Date(),
                  dateAdded: new Date(), // Move game to top when auto-approved update is detected
                  gameLink: bestMatch.link,
                  title: cleanGameTitle(decodedTitle), // Clean the title before saving
                  originalTitle: bestMatch.title, // Update original title to the new post title
                  // Update source info so download links fetch from the correct site
                  ...(bestMatch.id && { gameId: bestMatch.id }),
                  ...(bestMatch.source && { source: bestMatch.source }),
                  hasNewUpdate: true,
                  newUpdateSeen: false,
                  latestApprovedUpdate: {
                    version: versionString,
                    dateFound: bestMatch.date || new Date().toISOString(),
                    gameLink: bestMatch.link,
                    downloadLinks: bestMatch.downloadLinks || []
                  }
                };

                // Update version or build numbers based on what was detected
                if (newVersionInfo.version) {
                  updateFields.currentVersionNumber = newVersionInfo.version;
                  updateFields.versionNumberVerified = true;
                  updateFields.versionNumberSource = 'automatic';
                  updateFields.versionNumberLastUpdated = new Date();
                  logger.info(`Updated version number to: ${newVersionInfo.version}`);
                }
                
                if (newVersionInfo.build) {
                  updateFields.currentBuildNumber = newVersionInfo.build;
                  updateFields.buildNumberVerified = true;
                  // Distinguish SteamDB-enriched builds from title-extracted builds
                  const titleExtracted = extractVersionInfo(decodedTitle);
                  updateFields.buildNumberSource = (titleExtracted.build === newVersionInfo.build) ? 'automatic' : 'steamdb_auto';
                  updateFields.buildNumberLastUpdated = new Date();
                  logger.info(`Updated build number to: ${newVersionInfo.build}`);
                } else if (newVersionInfo.version) {
                  // New update has version but no build - clear stale build data
                  updateFields.currentBuildNumber = '';
                  updateFields.buildNumberVerified = false;
                  updateFields.buildNumberSource = '';
                  logger.info(`Cleared stale build number (new update has version only: ${newVersionInfo.version})`);
                }

                // Atomic conditional update to prevent duplicate auto-approvals
                const hasCandidateSignature = !!(candidateBuild || candidateDetectedVersion);

                const autoApproveWriteResult = await TrackedGame.findOneAndUpdate(
                  hasCandidateSignature
                    ? { _id: game._id }
                    : {
                        _id: game._id,
                        'updateHistory.gameLink': { $ne: bestMatch.link }
                      },
                  updateFields,
                  { new: true }
                );

                if (!autoApproveWriteResult) {
                  logger.info(`Skipping duplicate auto-approval (atomic check): ${bestMatch.link}`);
                  continue;
                }

                logger.info(`Auto-approved update for ${game.title}: ${versionString}`);
                updatesFound++;
                
                // Send notification only if enabled for this game
                if (game.notificationsEnabled) {
                  try {
                    // Fetch full download links for auto-approved updates
                    const downloadLinks = await fetchDownloadLinks(bestMatch);
                    
                    const notificationData = createUpdateNotificationData({
                      gameTitle: game.title,
                      version: versionString,
                      gameLink: bestMatch.link,
                      imageUrl: bestMatch.image,
                      updateType: 'update',
                      downloadLinks: downloadLinks
                    });
                    
                    await sendUpdateNotification(game.userId.toString(), notificationData);
                    
                    // Mark notification as sent
                    await TrackedGame.updateOne(
                      { _id: game._id, 'updateHistory.gameLink': bestMatch.link },
                      { $set: { 'updateHistory.$.notificationSent': true } }
                    );
                    
                    logger.info(`Update notification sent for ${game.title}`);
                  } catch (notificationError) {
                    logger.error('Failed to send update notification:', notificationError);
                  }
                } else {
                  logger.info(`Update found for ${game.title} but notifications are disabled`);
                }
              } else {
                logger.debug(`⏩ Skipping update that did not meet auto-approval criteria: "${decodedTitle}" | ${comparisonReason}`);
              }
            }
          }
        }
        
        // Update last checked for all games
        await TrackedGame.findByIdAndUpdate(game._id, {
          lastChecked: new Date()
        });
        
        const gameEndTime = Date.now();
  logger.debug(`Completed ${game.title} in ${gameEndTime - gameStartTime}ms`);

      } catch (error) {
        const gameEndTime = Date.now();
  logger.error(`Error checking ${game.title} after ${gameEndTime - gameStartTime}ms:`, error);
        errors++;
        
        // Update last checked even on error
        await TrackedGame.findByIdAndUpdate(game._id, {
          lastChecked: new Date()
        });
      }
    }

    const endTime = Date.now();
    const totalMs = endTime - startTime;
  logger.info(`Update check completed in ${totalMs}ms: ${updatesFound} updates, ${sequelsFound} sequels, ${errors} errors`);

    return NextResponse.json({
      message: `Update check completed in ${totalMs}ms using recent feed`,
      checked: trackedGames.length,
      updatesFound,
      sequelsFound,
      errors,
      totalTimeMs: totalMs,
      method: 'recent_feed',
      recentGamesProcessed: recentGames.length
    });

  } catch (error) {
  logger.error('Update check error:', error);
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    );
  }
}

// Get update check status/history
export async function GET() {
  try {
    const user = await getCurrentUser();
      let fullUser = null as null | {
        preferences?: {
          releaseGroups?: {
            prefer0xdeadcodeForOnlineFixes?: boolean;
          }
        }
      };
      if (user && user.id) {
        // Fetch full user doc for preferences
        try {
          fullUser = await mongoose.model('User').findById(user.id).lean() as {
            preferences?: {
              releaseGroups?: {
                prefer0xdeadcodeForOnlineFixes?: boolean;
              }
            }
          };
        } catch (e) {
          logger.warn('Could not fetch full user doc for preferences:', e);
        }
      }
              const _userPrefersOnlineFix = fullUser?.preferences?.releaseGroups?.prefer0xdeadcodeForOnlineFixes;
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    const totalTracked = await TrackedGame.countDocuments({ 
      userId: user.id,
      isActive: true 
    });
    const recentUpdates = await TrackedGame.find({
      userId: user.id,
      'updateHistory.0': { $exists: true }
    })
    .sort({ 'updateHistory.dateFound': -1 })
    .limit(10)
    .select('title updateHistory');

    const lastChecked = await TrackedGame.findOne({
      userId: user.id,
      lastChecked: { $exists: true }
    })
    .sort({ lastChecked: -1 })
    .select('lastChecked');

    return NextResponse.json({
      totalTracked,
      lastGlobalCheck: lastChecked?.lastChecked,
      recentUpdates: recentUpdates.map((game: { title: string; updateHistory: { version: string; dateFound: string }[] }) => {
        const sorted = [...game.updateHistory].sort((a, b) => new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime());
        return {
          title: game.title,
          latestUpdate: sorted[0]
        };
      })
    });

  } catch (error) {
  logger.error('Get update status error:', error);
    return NextResponse.json(
      { error: 'Failed to get update status' },
      { status: 500 }
    );
  }
}