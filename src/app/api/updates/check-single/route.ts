import { NextResponse } from 'next/server';

import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel } from '../../../../utils/sequelDetection';
import { cleanGameTitle, cleanGameTitlePreserveEdition, decodeHtmlEntities, resolveBuildFromVersion, resolveVersionFromBuild } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';
import { detectUpdatesWithAI, isAIDetectionAvailable, prepareCandidatesForAI } from '../../../../utils/aiUpdateDetection';

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
async function canAutoApprove(game: TrackedGameDocument, newVersionInfo: VersionInfo): Promise<{canApprove: boolean; reason: string}> {
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
  
  // First try verified version number
  if (game.versionNumberVerified && game.currentVersionNumber) {
    currentInfo = extractVersionInfo(game.currentVersionNumber);
  logger.debug(`Checking verified version number: ${game.currentVersionNumber}`);
    
    const comparison = compareVersions(currentInfo, newVersionInfo);
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

function calculateGameSimilarity(title1: string, title2: string): number {
  const clean1 = cleanGameTitle(title1).toLowerCase();
  const clean2 = cleanGameTitle(title2).toLowerCase();
  
  if (clean1 === clean2) return 1.0;
  
  // Check for substring matches
  if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.85;
  
  // Split into words and check overlap
  const words1 = clean1.split(/\s+/);
  const words2 = clean2.split(/\s+/);
  
  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];
  
  return intersection.length / union.length;
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
  
  return {
    version,
    build,
    releaseType,
    updateType,
    baseTitle: cleanTitle,
    fullVersionString: `${version}${build ? ` Build ${build}` : ''}${releaseType ? ` ${releaseType}` : ''}`,
    confidence,
    needsUserConfirmation: confidence < 0.7
  };
}

function compareVersions(oldVersion: VersionInfo, newVersion: VersionInfo): { isNewer: boolean; changeType: string; significance: number } {
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

  return { isNewer, changeType, significance };
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
        
        // AI-First Enhanced Update Detection
        let isUpdateCandidate = false;
        let aiConfidence = 0;
        let aiReason = '';
        let enhancedScore = similarity;
        
        // Try AI detection first if available
        const aiAvailable = await isAIDetectionAvailable();
        
        if (aiAvailable && similarity >= 0.75) {
          try {
            logger.debug(`🤖 Using AI-first detection for: "${decodedTitle}" (similarity: ${similarity.toFixed(2)})`);
            
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
                minConfidence: 0.4,  // Lower threshold for single game check
                requireVersionPattern: false,  // Let AI decide
                debugLogging: true,
                maxCandidates: 1
              }
            );

            if (aiResults.length > 0) {
              const aiResult = aiResults[0];
              aiConfidence = aiResult.confidence;
              aiReason = aiResult.reason;
              
              // Enhanced scoring: 40% similarity, 60% AI confidence
              enhancedScore = similarity * 0.4 + aiResult.confidence * 0.6;
              
              // AI decides if it's an update
              isUpdateCandidate = aiResult.isUpdate && aiResult.confidence >= 0.5;
              
              logger.debug(`🤖 AI analysis: Update=${aiResult.isUpdate}, Confidence=${aiConfidence.toFixed(2)}, Enhanced Score=${enhancedScore.toFixed(2)}, Reason=${aiReason}`);
            } else {
              logger.debug(`🤖 AI analysis: No results returned`);
              // Fallback to regex if AI returns no results
              isUpdateCandidate = comparison.isNewer || newVersionInfo.needsUserConfirmation;
              aiReason = 'AI provided no analysis, using regex fallback';
            }
            
          } catch (aiError) {
            logger.debug(`⚠️ AI detection failed: ${aiError instanceof Error ? aiError.message : 'unknown error'}`);
            // Fallback to enhanced regex detection
            isUpdateCandidate = comparison.isNewer || newVersionInfo.needsUserConfirmation;
            
            // Enhanced regex scoring when AI fails
            const titleLower = decodedTitle.toLowerCase();
            const gameTitle = game.title.toLowerCase();
            
            // Enhanced update keyword detection
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
            
            // Enhanced version pattern detection
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
            aiReason = `Enhanced regex analysis: ${updateIndicators} update indicators (AI unavailable)`;
            
            // Boost confidence if we have strong indicators
            if (updateIndicators >= 2 && similarity >= 0.85) {
              isUpdateCandidate = true;
            }
          }
        } else {
          // AI not available or similarity too low - use enhanced regex only
          isUpdateCandidate = comparison.isNewer || newVersionInfo.needsUserConfirmation;
          aiReason = aiAvailable ? 'Similarity below AI threshold (0.75)' : 'AI detection not available';
          
          logger.debug(`🤖 ${aiReason}, using regex detection: ${isUpdateCandidate}`);
        }
        
        logger.debug(`🎯 Final decision: isUpdateCandidate=${isUpdateCandidate}, hasVersion=${!!newVersionInfo.version}, hasBuild=${!!newVersionInfo.build}`);
        
        // Only proceed if it's a candidate and has some version info
        if (isUpdateCandidate && (newVersionInfo.version || newVersionInfo.build)) {
          logger.debug(`🔗 Download links in result:`, result.downloadLinks);
          
          // Check if we already have this update in pending
          const existingPending = game.pendingUpdates?.some((pending: PendingUpdate) => 
            pending.version === decodedTitle && pending.gameLink === result.link
          );
          
          if (!existingPending) {
            // Check if we can auto-approve based on verified version/build numbers
            const autoApproveResult = await canAutoApprove(game, newVersionInfo);
            logger.debug(`\n🤖 Auto-approval decision:`, autoApproveResult);
            
              // Create base update data (enhanced with AI information)
            const updateData = {
              version: decodedTitle,
              build: newVersionInfo.build,
              releaseType: newVersionInfo.releaseType,
              updateType: newVersionInfo.updateType,
              changeType: comparison.changeType,
              significance: comparison.significance,
              dateFound: new Date().toISOString(),
              gameLink: result.link,
              previousVersion: game.lastKnownVersion || game.title,
              downloadLinks: result.downloadLinks || [],
              steamEnhanced: false,
              steamAppId: game.steamAppId,
              needsUserConfirmation: !autoApproveResult.canApprove && (newVersionInfo.needsUserConfirmation || comparison.significance < 2),
              autoApprovalReason: autoApproveResult.reason,
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

              await TrackedGame.findByIdAndUpdate(game._id, updateFields);
              
            } else {
              // Only add to pending if version or build is present
              if (!newVersionInfo.version && !newVersionInfo.build) {
                logger.debug(`⚠️ Skipping game without valid version or build: "${decodedTitle}"`);
                continue; // Don't return here, continue checking other results
              }
              
              // Add to pending updates if can't auto-approve
              await TrackedGame.findByIdAndUpdate(game._id, {
                $push: { pendingUpdates: updateData },
                lastChecked: new Date()
              });
            }

            // Send notification for the update
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
              logger.debug(`📢 ${autoApproveResult.canApprove ? 'Auto-approved' : 'Pending'} update notification sent for ${game.title}`);
            } catch (notificationError) {
              logger.error(`Failed to send update notification for ${game.title}:`, notificationError);
              // Don't fail the whole operation if notification fails
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