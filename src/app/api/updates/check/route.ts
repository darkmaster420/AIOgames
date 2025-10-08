import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, ReleaseGroupVariant } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel } from '../../../../utils/sequelDetection';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';
import { cleanGameTitle, decodeHtmlEntities, resolveBuildFromVersion, resolveVersionFromBuild } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';
import { extractReleaseGroup, analyzeGameTitle } from '../../../../utils/versionDetection';

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
}

interface EnhancedMatch {
  game: GameSearchResult;
  similarity: number;
  versionInfo: VersionInfo;
  gate: string;
  aiConfidence?: number;
  aiReason?: string;
  enhancedScore?: number;
}

// Helper functions - enhanced for comprehensive piracy tag handling
function calculateGameSimilarity(title1: string, title2: string): number {
  const clean1 = cleanGameTitle(title1).toLowerCase();
  const clean2 = cleanGameTitle(title2).toLowerCase();
  
  if (clean1 === clean2) return 1.0;
  
  // Check for substring matches
  if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.85;
  
  // Split into words and check overlap
  const words1 = clean1.split(/\s+/);
  const words2 = clean2.split(/\s+/);
  
  const intersection = words1.filter((word: string) => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];
  
  return intersection.length / union.length;
}

// Enhanced version extraction with comprehensive piracy release support
function extractVersionInfo(title: string): VersionInfo {
  const originalTitle = title;
  const cleanTitle = cleanGameTitle(title);
  
  // Extract version patterns - comprehensive coverage for piracy releases
  const versionPatterns = [
    /v(\d+\.\d+\.\d+\.\d+)/i,              // v1.2.3.4
    /v(\d{4}[-.]?\d{2}[-.]?\d{2})/i,        // v2024-01-15, v20240115
    /v(\d{8})/i,                            // v20240115
    /v(\d+(?:\.\d+)+)/i,                   // v1.2.3
    /version\s*(\d+(?:\.\d+)+)/i,           // version 1.2.3
    /ver\.?\s*(\d+(?:\.\d+)+)/i,            // ver 1.2, ver. 1.2
    /(\d+\.\d+(?:\.\d+)*)/,               // 1.2.3 (standalone)
    /\[(\d+\.\d+(?:\.\d+)*)\]/i,          // [1.2.3] (bracketed)
    /\-(\d+\.\d+(?:\.\d+)*)\-/i,          // -1.2.3- (dashed)
    /update\s*(\d+(?:\.\d+)*)/i,           // update 1.5
    /patch\s*(\d+(?:\.\d+)*)/i,            // patch 1.2
    /hotfix\s*(\d+(?:\.\d+)*)/i,           // hotfix 1.1
    /rev\s*(\d+(?:\.\d+)*)/i,              // rev 2.1
    /r(\d+(?:\.\d+)*)/i                    // r1.5
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
  
  return {
    version,
    build,
    releaseType,
    updateType,
    baseTitle: cleanTitle,
    fullVersionString: `${version}${build ? ` Build ${build}` : ''}${releaseType ? ` ${releaseType}` : ''}`,
    confidence: Math.min(confidence, 1.0), // Cap at 1.0
    needsUserConfirmation: confidence < 0.7
  };
}

function compareVersions(oldVersion: VersionInfo, newVersion: VersionInfo): { isNewer: boolean; changeType: string; significance: number } {
  let isNewer = false;
  let changeType = 'unknown';
  let significance = 0;
  
  if (oldVersion.version && newVersion.version) {
    const oldParts = oldVersion.version.split('.').map(Number);
    const newParts = newVersion.version.split('.').map(Number);
    
    const maxLength = Math.max(oldParts.length, newParts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const oldPart = oldParts[i] || 0;
      const newPart = newParts[i] || 0;
      
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
          changeType = 'build';
          significance = 2;
        }
        break;
      } else if (newPart < oldPart) {
        break;
      }
    }
  }
  
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

  return { isNewer, changeType, significance };
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

    logger.debug(`AI Detection preferences: enabled=${aiPreferences.enabled}, threshold=${aiPreferences.autoApprovalThreshold}`);

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

        for (const gate of gates) {
          for (const recentGame of recentGames) {
            const decodedTitle = decodeHtmlEntities(recentGame.title);
            const similarity = calculateGameSimilarity(gate.value, decodedTitle);
            if (similarity >= 0.8) {
              const versionInfo = extractVersionInfo(decodedTitle);
              potentialMatches.push({ game: recentGame, similarity, versionInfo, gate: gate.label });
            }
            // Also check for sequels (moderate similarity)
            if (similarity >= 0.5 && similarity < 0.8 && gate.label === 'cleaned') {
              const sequelResult = detectSequel(game.title, decodedTitle);
              if (sequelResult && sequelResult.isSequel) {
                const existingSequel = game.sequelNotifications?.some((sequel: { detectedTitle: string; gameLink: string }) =>
                  sequel.detectedTitle === decodedTitle && sequel.gameLink === recentGame.link
                );
                if (!existingSequel) {
                  await TrackedGame.findByIdAndUpdate(game._id, {
                    $push: {
                      sequelNotifications: {
                        detectedTitle: decodedTitle,
                        gameId: recentGame.id,
                        gameLink: recentGame.link,
                        image: recentGame.image || '',
                        description: recentGame.description || '',
                        source: recentGame.source,
                        similarity,
                        sequelType: sequelResult.sequelType,
                        dateFound: new Date(),
                        downloadLinks: recentGame.downloadLinks || []
                      }
                    }
                  });
                  try {
                    const notificationData = createUpdateNotificationData({
                      gameTitle: game.title,
                      gameLink: recentGame.link,
                      imageUrl: recentGame.image,
                      updateType: 'sequel'
                    });
                    await sendUpdateNotification(game.userId.toString(), notificationData);
                    logger.info(`Sequel found: ${game.title} -> ${decodedTitle}`);
                  } catch (notificationError) {
                    logger.error('Failed to send sequel notification:', notificationError);
                  }
                  sequelsFound++;
                }
              }
            }
          }
          // If we found matches in this gate, stop and use only these
          if (potentialMatches.length > 0) {
            bestGate = gate.label;
            break;
          }
        }

        // Now select the best match based on what the tracked game has verified
  logger.debug(`Found ${potentialMatches.length} potential matches for "${game.title}" (gate: ${bestGate})`);
        
        let selectedMatch: EnhancedMatch | null = null;

        if (potentialMatches.length > 0) {
          let sortedMatches: EnhancedMatch[] = [...potentialMatches];
          const hasVerifiedVersion = game.versionNumberVerified && game.currentVersionNumber;
          const hasVerifiedBuild = game.buildNumberVerified && game.currentBuildNumber;
          logger.debug(`Game verification status: Version=${hasVerifiedVersion ? game.currentVersionNumber : 'No'}, Build=${hasVerifiedBuild ? game.currentBuildNumber : 'No'}`);
          
          // Enhanced sorting with AI assistance for uncertain matches
          const aiEnhancedMatches: EnhancedMatch[] = [];
          const uncertainMatches = sortedMatches.filter(m => 
            m.similarity >= 0.8 && m.similarity < 0.95 && 
            (!hasVerifiedVersion && !hasVerifiedBuild)
          );

          if (uncertainMatches.length > 0 && aiPreferences.enabled) {
            try {
              // Use AI to analyze uncertain matches
              logger.debug(`🤖 Analyzing ${uncertainMatches.length} uncertain matches with AI`);
              
              const { detectUpdatesWithAI, prepareCandidatesForAI } = await import('../../../../utils/aiUpdateDetection');
              
              const candidates = prepareCandidatesForAI(
                uncertainMatches.map(m => ({
                  title: m.game.title,
                  link: m.game.link,
                  date: m.game.date,
                  similarity: m.similarity
                })),
                game.title,
                { maxCandidates: Math.min(5, uncertainMatches.length), minSimilarity: 0.8 }
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
                  minConfidence: 0.6,
                  requireVersionPattern: true, // Only consider candidates with version/build patterns
                  debugLogging: aiPreferences.debugLogging
                }
              );

              // Enhance matches with AI confidence
              for (const match of uncertainMatches) {
                const aiResult = aiResults.find(ai => ai.title === match.game.title);
                if (aiResult && aiResult.isUpdate) {
                  aiEnhancedMatches.push({
                    ...match,
                    aiConfidence: aiResult.confidence,
                    aiReason: aiResult.reason,
                    enhancedScore: match.similarity * 0.7 + aiResult.confidence * 0.3
                  });
                  logger.debug(`🤖✨ AI enhanced match: "${match.game.title}" (confidence: ${aiResult.confidence.toFixed(2)})`);
                } else {
                  aiEnhancedMatches.push({
                    ...match,
                    aiConfidence: 0,
                    aiReason: 'Not detected as update by AI',
                    enhancedScore: match.similarity * 0.9
                  });
                }
              }

              // Replace uncertain matches with AI-enhanced ones
              sortedMatches = [
                ...sortedMatches.filter(m => !uncertainMatches.includes(m)),
                ...aiEnhancedMatches
              ];

            } catch (aiError) {
              logger.warn(`⚠️ AI enhancement failed: ${aiError instanceof Error ? aiError.message : 'unknown error'}`);
              // Continue with original matches if AI fails and fallback is enabled
              if (!aiPreferences.fallbackToRegex) {
                logger.warn('AI fallback disabled, skipping uncertain matches');
                sortedMatches = sortedMatches.filter(m => !uncertainMatches.includes(m));
              }
            }
          } else if (uncertainMatches.length > 0 && !aiPreferences.enabled) {
            logger.debug('🤖 AI detection disabled, using regex-only for uncertain matches');
          }

          if (hasVerifiedVersion && hasVerifiedBuild) {
            logger.debug('Using both version and build number comparison');
            sortedMatches.sort((a, b) => {
              const aVersion = parseFloat(a.versionInfo.version || '0');
              const bVersion = parseFloat(b.versionInfo.version || '0');
              const aBuild = parseInt(a.versionInfo.build || '0');
              const bBuild = parseInt(b.versionInfo.build || '0');
              if (bVersion !== aVersion) return bVersion - aVersion;
              return bBuild - aBuild;
            });
          } else if (hasVerifiedVersion) {
            logger.debug('Using version number comparison only');
            sortedMatches = sortedMatches.filter(m => m.versionInfo.version);
            sortedMatches.sort((a, b) => {
              const aVersion = parseFloat(a.versionInfo.version || '0');
              const bVersion = parseFloat(b.versionInfo.version || '0');
              return bVersion - aVersion;
            });
          } else if (hasVerifiedBuild) {
            logger.debug('Using build number comparison only');
            sortedMatches = sortedMatches.filter(m => m.versionInfo.build);
            sortedMatches.sort((a, b) => {
              const aBuild = parseInt(a.versionInfo.build || '0');
              const bBuild = parseInt(b.versionInfo.build || '0');
              return bBuild - aBuild;
            });
          } else {
            logger.debug('Using AI-enhanced similarity-based comparison');
            sortedMatches.sort((a, b) => {
              // Use AI-enhanced score if available, otherwise fall back to similarity
              const aScore = a.enhancedScore || a.similarity;
              const bScore = b.enhancedScore || b.similarity;
              if (bScore !== aScore) return bScore - aScore;
              const aVersion = parseFloat(a.versionInfo.version || '0');
              const bVersion = parseFloat(b.versionInfo.version || '0');
              const aBuild = parseInt(a.versionInfo.build || '0');
              const bBuild = parseInt(b.versionInfo.build || '0');
              if (bVersion !== aVersion) return bVersion - aVersion;
              return bBuild - aBuild;
            });
          }
          bestMatch = sortedMatches[0]?.game || null;
          bestSimilarity = sortedMatches[0]?.similarity || 0;
          selectedMatch = sortedMatches[0] || null;
          if (bestMatch) {
            logger.debug(`Selected best match: "${bestMatch.title}" (similarity: ${bestSimilarity.toFixed(2)}, gate: ${bestGate})`);
            if (selectedMatch?.aiConfidence) {
              logger.debug(`🤖 AI confidence: ${selectedMatch.aiConfidence.toFixed(2)} - ${selectedMatch.aiReason}`);
            }
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
              needsUserConfirmation: false 
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

          const newVersionInfo = extractVersionInfo(decodedTitle);

          // If we detected only version or only build, try to resolve the missing one via SteamDB Worker when appId is known
          if (game.steamAppId) {
            try {
              if (newVersionInfo.version && !newVersionInfo.build) {
                const build = await resolveBuildFromVersion(game.steamAppId, newVersionInfo.version);
                if (build) {
                  newVersionInfo.build = build;
                  logger.info(`Resolved build ${build} from version ${newVersionInfo.version} via SteamDB`);
                }
              } else if (!newVersionInfo.version && newVersionInfo.build) {
                const version = await resolveVersionFromBuild(game.steamAppId, newVersionInfo.build);
                if (version) {
                  newVersionInfo.version = version;
                  logger.info(`Resolved version ${version} from build ${newVersionInfo.build} via SteamDB`);
                }
              }
            } catch (e) {
              logger.debug('Version↔build resolution skipped:', e instanceof Error ? e.message : 'unknown');
            }
          }
          
          // Enhanced comparison that respects verification preferences
          let isActuallyNewer = false;
          let comparisonReason = '';
          
          if (hasVerifiedVersion && hasVerifiedBuild) {
            // Compare both version and build
            const currentVersion = parseFloat(currentVersionInfo.version || '0');
            const newVersion = parseFloat(newVersionInfo.version || '0');
            const currentBuild = parseInt(currentVersionInfo.build || '0');
            const newBuild = parseInt(newVersionInfo.build || '0');
            
            if (newVersion > currentVersion || (newVersion === currentVersion && newBuild > currentBuild)) {
              isActuallyNewer = true;
              comparisonReason = `Version/Build: ${currentVersionInfo.version || '0'}/${currentVersionInfo.build || '0'} → ${newVersionInfo.version || '0'}/${newVersionInfo.build || '0'}`;
            }
          } else if (hasVerifiedVersion) {
            // Only compare versions
            const currentVersion = parseFloat(game.currentVersionNumber || '0');
            const newVersion = parseFloat(newVersionInfo.version || '0');
            
            if (newVersion > currentVersion) {
              isActuallyNewer = true;
              comparisonReason = `Version: ${currentVersion} → ${newVersion}`;
            }
          } else if (hasVerifiedBuild) {
            // Only compare builds
            const currentBuild = parseInt(game.currentBuildNumber || '0');
            const newBuild = parseInt(newVersionInfo.build || '0');
            
            if (newBuild > currentBuild) {
              isActuallyNewer = true;
              comparisonReason = `Build: ${currentBuild} → ${newBuild}`;
            }
          } else {
            // Fall back to general comparison
            const comparison = compareVersions(currentVersionInfo, newVersionInfo);
            isActuallyNewer = comparison.isNewer && comparison.significance >= 2;
            comparisonReason = `General comparison: ${comparison.changeType} (significance: ${comparison.significance})`;
          }
          
          // Check if it's different content (different link) or actually newer
          const isDifferentLink = game.gameLink !== bestMatch.link;
          
          logger.debug(`Update analysis: Different link=${isDifferentLink}, Newer=${isActuallyNewer}, Reason=${comparisonReason}`);
          
          if (isDifferentLink || isActuallyNewer) {
            logger.info(`Update found: ${decodedTitle} (different link: ${isDifferentLink}, newer: ${isActuallyNewer})`);
            
            // Check if we already have this update
            const existingUpdate = game.updateHistory?.some((update: { gameLink: string }) => 
              update.gameLink === bestMatch.link
            );
            
            const existingPending = game.pendingUpdates?.some((pending: { newLink: string }) => 
              pending.newLink === bestMatch.link
            );
            
            if (!existingUpdate && !existingPending) {
              // Create version string
              let versionString = decodedTitle;
              if (newVersionInfo.version) {
                versionString = `v${newVersionInfo.version}`;
                if (newVersionInfo.build) versionString += ` Build ${newVersionInfo.build}`;
                if (newVersionInfo.releaseType) versionString += ` ${newVersionInfo.releaseType}`;
              }
              

              // Get AI detection data if available
              const aiData = selectedMatch?.aiConfidence ? {
                aiDetectionConfidence: selectedMatch.aiConfidence,
                aiDetectionReason: selectedMatch.aiReason,
                detectionMethod: 'ai_enhanced'
              } : {};

              // Auto-approve if:
              // - We have verified info and it's clearly higher, or
              // - Similarity is 100% and significance >= 2 (robust match), or
              // - AI has high confidence (>= user threshold) for the update
              const shouldAutoApprove = (
                ((hasVerifiedVersion || hasVerifiedBuild) && isActuallyNewer && bestSimilarity >= 0.85) ||
                (bestSimilarity === 1.0 && isActuallyNewer) ||
                (selectedMatch?.aiConfidence && selectedMatch.aiConfidence >= aiPreferences.autoApprovalThreshold)
              );

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
                  ...aiData  // Include AI detection data if available
                };

                const updateFields: Record<string, unknown> = {
                  $push: { updateHistory: approvedUpdate },
                  lastKnownVersion: versionString,
                  lastVersionDate: bestMatch.date || new Date().toISOString(),
                  lastChecked: new Date(),
                  gameLink: bestMatch.link,
                  title: decodedTitle,
                  hasNewUpdate: true,
                  newUpdateSeen: false
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
                  updateFields.buildNumberSource = 'automatic';
                  updateFields.buildNumberLastUpdated = new Date();
                  logger.info(`Updated build number to: ${newVersionInfo.build}`);
                }

                await TrackedGame.findByIdAndUpdate(game._id, updateFields);

                logger.info(`Auto-approved update for ${game.title}: ${versionString}`);
                updatesFound++;
              } else {
                // Check if the detected game has version or build information before adding to pending
                const hasVersionOrBuild = newVersionInfo.version || newVersionInfo.build || 
                  /\b(v?\d+(?:\.\d+)+|\d{6,}|build\s*\d+|b\d{4,}|#\d{4,})\b/i.test(decodedTitle);
                
                if (!hasVersionOrBuild) {
                  logger.debug(`Skipping game without version/build info: "${decodedTitle}"`);
                  continue; // Skip adding to pending if no version/build information
                }
                
                // Add to pending updates with AI data
                const aiData = selectedMatch?.aiConfidence ? {
                  aiDetectionConfidence: selectedMatch.aiConfidence,
                  aiDetectionReason: selectedMatch.aiReason,
                  detectionMethod: 'ai_enhanced'
                } : {};

                const pendingUpdate = {
                  detectedVersion: newVersionInfo.version || '',
                  build: newVersionInfo.build || '',
                  releaseType: newVersionInfo.releaseType || '',
                  updateType: newVersionInfo.updateType || '',
                  newTitle: decodedTitle,
                  newLink: bestMatch.link,
                  newImage: bestMatch.image || '',
                  dateFound: new Date(),
                  confidence: bestSimilarity,
                  reason: `${comparisonReason} | Similarity: ${Math.round(bestSimilarity * 100)}%${selectedMatch?.aiConfidence ? ` | AI: ${Math.round(selectedMatch.aiConfidence * 100)}%` : ''}`,
                  downloadLinks: bestMatch.downloadLinks || [],
                  ...aiData  // Include AI detection data if available
                };

                await TrackedGame.findByIdAndUpdate(game._id, {
                  $push: { pendingUpdates: pendingUpdate },
                  lastChecked: new Date()
                });

                logger.info(`Added pending update for ${game.title}: ${versionString}`);
                updatesFound++;
              }
              
              // Send notification
              try {
                const notificationData = createUpdateNotificationData({
                  gameTitle: game.title,
                  version: versionString,
                  gameLink: bestMatch.link,
                  imageUrl: bestMatch.image,
                  updateType: 'update'
                });
                
                await sendUpdateNotification(game.userId.toString(), notificationData);
                logger.info(`Update notification sent for ${game.title}`);
              } catch (notificationError) {
                logger.error('Failed to send update notification:', notificationError);
              }

              // Collect release group variant from the new update
              try {
                logger.debug(`Attempting release group extraction for update: "${decodedTitle}"`);
                
                const releaseGroupResult = extractReleaseGroup(decodedTitle);
                
                if (releaseGroupResult.releaseGroup && releaseGroupResult.releaseGroup !== 'UNKNOWN') {
                  logger.debug(`Detected release group in update: ${releaseGroupResult.releaseGroup}`);
                  
                  // Analyze the new title for version/build information
                  const analysis = analyzeGameTitle(decodedTitle);
                  
                  // Check if this release group variant already exists for this game
                  const existingVariant = await ReleaseGroupVariant.findOne({
                    trackedGameId: game._id,
                    releaseGroup: releaseGroupResult.releaseGroup
                  });

                  if (!existingVariant) {
                    const variant = new ReleaseGroupVariant({
                      trackedGameId: game._id,
                      gameId: bestMatch.id,
                      releaseGroup: releaseGroupResult.releaseGroup,
                      source: bestMatch.source,
                      title: decodedTitle,
                      gameLink: bestMatch.link,
                      version: analysis.detectedVersion || "",
                      buildNumber: analysis.detectedBuild || "",
                      dateFound: new Date()
                    });
                    await variant.save();
                    logger.debug(`Stored new release group variant from update: ${releaseGroupResult.releaseGroup} for game "${game.title}"`);
                  } else {
                    // Update existing variant with latest information
                    existingVariant.title = decodedTitle;
                    existingVariant.gameLink = bestMatch.link;
                    if (analysis.detectedVersion) existingVariant.version = analysis.detectedVersion;
                    if (analysis.detectedBuild) existingVariant.buildNumber = analysis.detectedBuild;
                    existingVariant.lastSeen = new Date();
                    await existingVariant.save();
                    logger.debug(`Updated existing release group variant: ${releaseGroupResult.releaseGroup} for game "${game.title}"`);
                  }
                } else {
                  logger.debug(`No release group detected in update title: "${decodedTitle}"`);
                }
                
              } catch (releaseGroupError) {
                logger.error('Release group extraction error:', releaseGroupError);
                // Don't fail the entire request if release group extraction fails
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
      recentUpdates: recentUpdates.map((game: { title: string; updateHistory: { version: string; dateFound: string }[] }) => ({
        title: game.title,
        latestUpdate: game.updateHistory[game.updateHistory.length - 1]
      }))
    });

  } catch (error) {
  logger.error('Get update status error:', error);
    return NextResponse.json(
      { error: 'Failed to get update status' },
      { status: 500 }
    );
  }
}