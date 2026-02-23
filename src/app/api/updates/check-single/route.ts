import { NextResponse } from 'next/server';

import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel } from '../../../../utils/sequelDetection';
import { cleanGameTitle, cleanGameTitlePreserveEdition, decodeHtmlEntities, resolveBuildFromVersion, resolveVersionFromBuild } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';
import { detectUpdatesWithAI, isAIDetectionAvailable, prepareCandidatesForAI } from '../../../../utils/aiUpdateDetection';
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
  
  // Check if version is suspicious - if so, require user confirmation
  if (versionComparison?.suspiciousVersion?.isSuspicious) {
    return {
      canApprove: false,
      reason: `Suspicious version pattern detected: ${versionComparison.suspiciousVersion.reason}. Please verify before approving.`
    };
  }
  
  // First try verified version number
  if (game.versionNumberVerified && game.currentVersionNumber) {
    currentInfo = extractVersionInfo(game.currentVersionNumber);
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
  // 1. Original title (most likely to have accurate version info)
  // 2. Last known version (previously verified)
  // 3. Steam enhanced title (if available)
  // 4. Clean title (fallback)
  const titleSources = [
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
    // v1.2.3a, v1.2.3.a, v1.2.3c, v1.2.3b, v1.2.3-beta, v1.2.3-alpha, etc. (version with suffix)
    /v(\d+(?:\.\d+)+(?:\.[a-z]|[a-z])?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,
    // Version 1.2.3a, Version 1.2.3.a, Version 1.2.3c, Version 1.2.3-beta, etc.
    /version\s*(\d+(?:\.\d+)+(?:\.[a-z]|[a-z])?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i,
    // Standalone version numbers with suffixes (at least two parts like 1.2a, 1.2.a, 1.2.3c)
    /(\d+\.\d+(?:\.\d+)*(?:\.[a-z]|[a-z])?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/,
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
    const oldParts = oldVersion.version.split('.').map(Number);
    const newParts = newVersion.version.split('.').map(Number);
    
    logger.debug(`🔍 Version parts: [${oldParts.join(',')}] vs [${newParts.join(',')}]`);
    
    const maxLength = Math.max(oldParts.length, newParts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const oldPart = oldParts[i] || 0;
      const newPart = newParts[i] || 0;
      
      logger.debug(`🔍 Comparing part ${i}: ${oldPart} vs ${newPart}`);
      
      if (newPart > oldPart) {
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
      } else if (newPart < oldPart) {
        logger.debug(`❌ Version is older`);
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

    // Get the clean title for searching (same approach as the search functionality)
    const cleanTitle = cleanGameTitle(game.title);
    const searchTitle = cleanGameTitlePreserveEdition(game.title);
    
    logger.debug(`🔍 Searching for: "${searchTitle}" (from "${game.title}")`);

    // Use the same search API that the main search uses
    const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
    const searchResponse = await fetch(`${baseUrl}/?search=${encodeURIComponent(searchTitle)}`);
    
    if (!searchResponse.ok) {
      throw new Error(`Search API request failed: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    
    // Extract results from API response
    let games: GameSearchResult[] = [];
    if (searchData.success && searchData.results && Array.isArray(searchData.results)) {
      games = searchData.results;
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
      const similarity = calculateGameSimilarity(cleanTitle, cleanedDecodedTitle);

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

        const newVersionInfo = extractVersionInfo(decodedTitle);

        // Enrich version/build via SteamDB Worker if one side is missing and we know the appId
        if (game.steamAppId) {
          try {
            if (newVersionInfo.version && !newVersionInfo.build) {
              const build = await resolveBuildFromVersion(game.steamAppId, newVersionInfo.version);
              if (build) {
                newVersionInfo.build = build;
                logger.debug(`🔗 Resolved build ${build} from version ${newVersionInfo.version} via SteamDB`);
              }
            } else if (!newVersionInfo.version && newVersionInfo.build) {
              const version = await resolveVersionFromBuild(game.steamAppId, newVersionInfo.build);
              if (version) {
                newVersionInfo.version = version;
                logger.debug(`🔗 Resolved version ${version} from build ${newVersionInfo.build} via SteamDB`);
              }
            }
          } catch (e) {
            logger.debug('ℹ️ Version↔build resolution skipped due to error:', e instanceof Error ? e.message : 'unknown');
          }
        }
        
        const comparison = compareVersions(currentVersionInfo, newVersionInfo);
        
        logger.debug(`📊 Comparison: isNewer=${comparison.isNewer}, current="${currentVersionInfo.version || currentVersionInfo.build}", new="${newVersionInfo.version || newVersionInfo.build}"`);
        
        // Regex-First Detection — AI only used as tiebreaker for uncertain cases
        let isUpdateCandidate = false;
        let aiConfidence = 0;
        let aiReason = '';
        let enhancedScore = similarity;
        
        // Step 1: Regex/version comparison is the primary detection method
        isUpdateCandidate = comparison.isNewer || newVersionInfo.needsUserConfirmation;
        
        // Enhanced regex scoring
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
            enhancedScore += 0.1;
          }
        }
        
        const versionPatterns = [
          /v\d+\.\d+\.\d+/i, /\d+\.\d+\.\d+/, /build\s*\d+/i, /patch\s*\d+/i,
          /update\s*\d+/i, /rev\s*\d+/i, /r\d+/i, /v\d{8}/i, /\d{4}[-\.]\d{2}[-\.]\d{2}/
        ];
        
        for (const pattern of versionPatterns) {
          if (pattern.test(decodedTitle)) {
            updateIndicators++;
            enhancedScore += 0.15;
          }
        }
        
        enhancedScore = Math.min(enhancedScore, 1.0);
        aiReason = `Regex analysis: ${updateIndicators} update indicators`;
        
        // Boost confidence if we have strong indicators
        if (updateIndicators >= 2 && similarity >= 0.85) {
          isUpdateCandidate = true;
        }
        
        // Step 2: Only use AI as tiebreaker when regex is uncertain
        // Uncertain = version comparison says not newer but we have update keywords/patterns
        const regexUncertain = !comparison.isNewer && updateIndicators > 0 && similarity >= 0.75;
        const aiAvailable = await isAIDetectionAvailable();
        
        if (regexUncertain && aiAvailable) {
          try {
            logger.debug(`🤖 Regex uncertain (isNewer=${comparison.isNewer}, indicators=${updateIndicators}), using AI as tiebreaker`);
            
            const candidates = prepareCandidatesForAI(
              [{ title: decodedTitle, link: result.link, date: result.date, similarity }],
              game.title,
              { maxCandidates: 1, minSimilarity: 0.75, includeDate: true }
            );

            const aiResults = await detectUpdatesWithAI(
              game.title,
              candidates,
              {
                lastKnownVersion: game.lastKnownVersion,
                releaseGroup: game.releaseGroup,
                gameLink: game.gameLink
              },
              {
                minConfidence: 0.5,
                requireVersionPattern: false,
                debugLogging: true,
                maxCandidates: 1
              }
            );

            if (aiResults.length > 0) {
              const aiResult = aiResults[0];
              aiConfidence = aiResult.confidence;
              aiReason = `AI tiebreaker: ${aiResult.reason}`;
              
              // AI breaks the tie — if it says it's an update with high confidence, accept it
              if (aiResult.isUpdate && aiResult.confidence >= 0.6) {
                isUpdateCandidate = true;
                logger.debug(`🤖 AI tiebreaker: YES update (confidence=${aiConfidence.toFixed(2)})`);
              } else {
                logger.debug(`🤖 AI tiebreaker: NOT update (confidence=${aiConfidence.toFixed(2)})`);
              }
            }
          } catch (aiError) {
            logger.debug(`⚠️ AI tiebreaker failed: ${aiError instanceof Error ? aiError.message : 'unknown error'}`);
            // Keep regex decision
          }
        } else if (!regexUncertain) {
          logger.debug(`✅ Regex decisive (isNewer=${comparison.isNewer}, indicators=${updateIndicators}), no AI needed`);
        }
        
        logger.debug(`🎯 Final decision: isUpdateCandidate=${isUpdateCandidate}, hasVersion=${!!newVersionInfo.version}, hasBuild=${!!newVersionInfo.build}`);
        
        // Only proceed if it's a candidate and has some version info
        if (isUpdateCandidate && (newVersionInfo.version || newVersionInfo.build)) {
          logger.debug(`🔗 Download links in result:`, result.downloadLinks);
          
          // Check if we already have this update in pending or history (fresh DB query to avoid race conditions)
          const freshGame = await TrackedGame.findById(game._id).lean() as { pendingUpdates?: Array<{ version?: string; gameLink?: string; newLink?: string }>; updateHistory?: Array<{ gameLink: string }> } | null;
          const existingPending = freshGame?.pendingUpdates?.some((pending: { version?: string; gameLink?: string; newLink?: string }) => 
            pending.gameLink === result.link || pending.newLink === result.link
          );
          const existingInHistory = freshGame?.updateHistory?.some((update: { gameLink: string }) => 
            update.gameLink === result.link
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
              previousVersion: game.lastKnownVersion || game.title,
              downloadLinks: result.downloadLinks || [],
              steamEnhanced: false,
              steamAppId: game.steamAppId,
              needsUserConfirmation: !autoApproveResult.canApprove && (newVersionInfo.needsUserConfirmation || comparison.significance < 2),
              autoApprovalReason: autoApproveResult.reason,
              confidence: newVersionInfo.confidence || (aiConfidence > 0 ? aiConfidence : similarity),
              reason: autoApproveResult.reason || (aiConfidence > 0 ? aiReason : 'Version number detected'),
              // AI enhancement data
              ...(aiConfidence > 0 && {
                aiDetectionConfidence: aiConfidence,
                aiDetectionReason: aiReason,
                detectionMethod: 'ai_enhanced'
              })
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
              const autoApproveResult2 = await TrackedGame.findOneAndUpdate(
                {
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
              // Only add to pending if version or build is present
              if (!newVersionInfo.version && !newVersionInfo.build) {
                logger.debug(`⚠️ Skipping game without valid version or build: "${decodedTitle}"`);
                continue; // Don't return here, continue checking other results
              }
              
              // Add to pending updates if can't auto-approve (atomic conditional to prevent duplicates)
              const pendingResult = await TrackedGame.findOneAndUpdate(
                {
                  _id: game._id,
                  'pendingUpdates.gameLink': { $ne: result.link },
                  'pendingUpdates.newLink': { $ne: result.link },
                  'updateHistory.gameLink': { $ne: result.link }
                },
                {
                  $push: { pendingUpdates: updateData },
                  lastChecked: new Date()
                },
                { new: true }
              );

              if (!pendingResult) {
                logger.info(`⏩ Skipping duplicate pending update (atomic check): ${result.link}`);
                continue;
              }
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
                
                logger.debug(`📢 ${autoApproveResult.canApprove ? 'Auto-approved' : 'Pending'} update notification sent for ${game.title}`);
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
            
            const status = autoApproveResult.canApprove ? '✅ Auto-approved' : '📝 Added pending';
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