import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel, getSequelThreshold } from '../../../../utils/sequelDetection';
import { SITE_VALUES } from '../../../../lib/sites';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';
import { findSteamMatches, cleanGameTitle, cleanGameTitlePreserveEdition, decodeHtmlEntities } from '../../../../utils/steamApi';

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

interface UpdateDetails {
  oldVersion: VersionInfo;
  newVersion: VersionInfo;
  comparison: { isNewer: boolean; changeType: string; significance: number };
  reason: string;
}

interface UpdateResult {
  isUpdate: boolean;
  details: UpdateDetails | null;
}

interface VersionInfo {
  version: string;
  build: string;
  releaseType: string;
  updateType: string;
  baseTitle: string;
  fullVersionString: string;
  confidence: number;
  sceneGroup: string;
  needsUserConfirmation: boolean;
}

// Enhanced game matching and update detection
function calculateGameSimilarity(title1: string, title2: string): number {
  // Use the enhanced title cleaning functions that preserve edition information when needed
  const cleanTitle1 = cleanGameTitlePreserveEdition(title1);
  const cleanTitle2 = cleanGameTitlePreserveEdition(title2);
  
  // If both titles have edition information, preserve it for more accurate matching
  const hasEditionInfo = (title: string) => 
    /\b(deluxe|premium|ultimate|collectors?|gold|standard|definitive|enhanced|complete|special|limited)\b/i.test(title);
  
  let finalTitle1, finalTitle2;
  
  if (hasEditionInfo(title1) || hasEditionInfo(title2)) {
    // Preserve edition information if either title has it
    finalTitle1 = cleanTitle1;
    finalTitle2 = cleanTitle2;
  } else {
    // Use standard cleaning for basic matching when no edition info is present
    finalTitle1 = cleanGameTitle(title1);
    finalTitle2 = cleanGameTitle(title2);
  }

  if (finalTitle1 === finalTitle2) return 1.0;

  // Check for substring matches
  if (finalTitle1.includes(finalTitle2) || finalTitle2.includes(finalTitle1)) return 0.8;
  
  // Split into words and check overlap
  const words1 = finalTitle1.split(/\s+/);
  const words2 = finalTitle2.split(/\s+/);
  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];
  
  return intersection.length / union.length;
}

function extractVersionInfo(title: string): VersionInfo {
  const result: VersionInfo = {
    version: '',
    build: '',
    releaseType: '',
    updateType: '',
    baseTitle: title,
    fullVersionString: '',
    confidence: 0,
    sceneGroup: '',
    needsUserConfirmation: false
  };

  // Scene group patterns (TENOKE, CODEX, etc.)
  const sceneGroupPattern = /-([A-Z0-9]{3,})\b/;
  const sceneMatch = title.match(sceneGroupPattern);
  if (sceneMatch) {
    result.sceneGroup = sceneMatch[1];
    // Remove scene group from title for cleaner processing
    result.baseTitle = title.replace(sceneMatch[0], '').trim();
  }

  // Version patterns (in order of priority)
  const versionPatterns = [
    // Semantic version patterns
    { pattern: /v?(\d+\.\d+\.\d+(?:\.\d+)?)/i, type: 'semantic', confidence: 0.9 },
    { pattern: /version\s*(\d+\.\d+(?:\.\d+)?)/i, type: 'semantic', confidence: 0.9 },
    { pattern: /ver\s*(\d+\.\d+(?:\.\d+)?)/i, type: 'semantic', confidence: 0.8 },
    
    // Build patterns
    { pattern: /build\s*(\d+)/i, type: 'build', confidence: 0.8 },
    { pattern: /b(\d+)/i, type: 'build', confidence: 0.7 },
    { pattern: /#(\d+)/i, type: 'build', confidence: 0.6 },
    
    // Date-based versions
    { pattern: /(\d{4}[-.]?\d{2}[-.]?\d{2})/i, type: 'date', confidence: 0.7 },
    { pattern: /(\d{8})/i, type: 'date', confidence: 0.6 },
    
    // Simple version patterns
    { pattern: /v(\d+)/i, type: 'major', confidence: 0.6 },
    { pattern: /(\d+\.\d+)/i, type: 'simple', confidence: 0.7 },
  ];

  // Release type patterns
  const releaseTypes = [
    { pattern: /\b(alpha|α)\b/i, type: 'Alpha', priority: 1 },
    { pattern: /\b(beta|β)\b/i, type: 'Beta', priority: 2 },
    { pattern: /\b(rc|release\s*candidate)\b/i, type: 'RC', priority: 3 },
    { pattern: /\b(pre-?release|preview)\b/i, type: 'Preview', priority: 2 },
    { pattern: /\b(final|gold|rtm|release)\b/i, type: 'Final', priority: 4 },
    { pattern: /\b(stable)\b/i, type: 'Stable', priority: 4 },
    { pattern: /\b(nightly|dev|development)\b/i, type: 'Dev', priority: 0 }
  ];

  // Update type patterns
  const updateTypes = [
    { pattern: /\b(hotfix|hot-fix)\b/i, type: 'Hotfix' },
    { pattern: /\b(patch)\b/i, type: 'Patch' },
    { pattern: /\b(update)\b/i, type: 'Update' },
    { pattern: /\b(dlc|downloadable\s*content)\b/i, type: 'DLC' },
    { pattern: /\b(expansion|addon|add-on)\b/i, type: 'Expansion' },
    { pattern: /\b(repack|re-pack)\b/i, type: 'Repack' },
    { pattern: /\b(remake|remaster)\b/i, type: 'Remake' },
    { pattern: /\b(goty|game\s*of\s*the\s*year)\b/i, type: 'GOTY' },
    { pattern: /\b(definitive|ultimate|enhanced|complete|deluxe|premium)\b/i, type: 'Enhanced' }
  ];

  // Extract version/build numbers
  let bestMatch = null;
  let highestConfidence = 0;

  for (const versionPattern of versionPatterns) {
    const match = title.match(versionPattern.pattern);
    if (match && versionPattern.confidence > highestConfidence) {
      bestMatch = {
        value: match[1],
        type: versionPattern.type,
        confidence: versionPattern.confidence,
        fullMatch: match[0]
      };
      highestConfidence = versionPattern.confidence;
    }
  }

  if (bestMatch) {
    if (bestMatch.type === 'build') {
      result.build = bestMatch.value;
    } else {
      result.version = bestMatch.value;
    }
    result.fullVersionString = bestMatch.fullMatch;
    result.confidence = bestMatch.confidence;
    result.baseTitle = title.replace(bestMatch.fullMatch, '').trim();
  }

  // Extract release type
  let highestPriority = -1;
  for (const releaseType of releaseTypes) {
    const match = title.match(releaseType.pattern);
    if (match && releaseType.priority > highestPriority) {
      result.releaseType = releaseType.type;
      highestPriority = releaseType.priority;
    }
  }

  // Extract update type
  for (const updateType of updateTypes) {
    const match = title.match(updateType.pattern);
    if (match) {
      result.updateType = updateType.type;
      break; // Take the first match
    }
  }

  // Clean up base title using improved algorithm that handles ZERO vs 0
  result.baseTitle = result.baseTitle
    // Remove common piracy/release tags first
    .replace(/\b(denuvoless|cracked|repack|fitgirl|dodi|empress|codex|skidrow|plaza)\b/gi, '')
    .replace(/\b(free download|full version|complete edition)\b/gi, '')
    .replace(/\b(all dlc|with dlc|dlc included)\b/gi, '')
    .replace(/\b(pre-installed|preinstalled)\b/gi, '')
    .replace(/\b(update \d+|hotfix|patch)\b/gi, '')
    // Remove common edition tags that don't affect core identity
    .replace(/\b(deluxe|digital deluxe|premium|ultimate|collectors?)\s+edition\b/gi, '')
    .replace(/\b(goty|game of the year)\s+edition\b/gi, '')
    // Remove year tags like (2023), (2024) etc
    .replace(/\(\d{4}\)/g, '')
    // Remove scene groups and release info
    .replace(/-[A-Z0-9]{3,}$/g, '') // Scene groups at end
    // Remove bracketed/parenthetical content
    .replace(/\[[^\]]*\]/g, '')    
    .replace(/\([^)]*\)/g, '')     
    // Remove trademark symbols
    .replace(/[®™©]/g, '')         
    // Normalize number words - key improvement for ZERO vs 0
    .replace(/\bzero\b/gi, '0')
    .replace(/\bone\b/gi, '1')
    .replace(/\btwo\b/gi, '2')
    .replace(/\bthree\b/gi, '3')
    .replace(/\bfour\b/gi, '4')
    .replace(/\bfive\b/gi, '5')
    .replace(/\bsix\b/gi, '6')
    .replace(/\bseven\b/gi, '7')
    .replace(/\beight\b/gi, '8')
    .replace(/\bnine\b/gi, '9')
    // Normalize roman numerals to numbers
    .replace(/\bii\b/gi, '2')
    .replace(/\biii\b/gi, '3')
    .replace(/\biv\b/gi, '4')
    .replace(/\bv\b(?!\w)/gi, '5') // \b at end to avoid matching "vs"
    .replace(/\bvi\b/gi, '6')
    .replace(/\bvii\b/gi, '7')
    .replace(/\bviii\b/gi, '8')
    .replace(/\bix\b/gi, '9')
    .replace(/\bx\b(?!\w)/gi, '10')
    // Normalize common variations
    .replace(/\band\b/gi, '&')
    .replace(/\bvs\.?\b/gi, 'vs')
    .replace(/\bof the\b/gi, 'of')
    // Normalize apostrophes and dashes
    .replace(/[']/g, '')           // Remove apostrophes (Assassin's -> Assassins)
    .replace(/[-:]/g, ' ')         // Convert dashes/colons to spaces
    // Remove special characters and normalize
    .replace(/[^\w\s&]/g, ' ')       
    .replace(/\s+/g, ' ')          
    .trim();

  // If no version info found, mark for user confirmation
  if (!result.version && !result.build && !result.updateType && result.confidence < 0.5) {
    result.needsUserConfirmation = true;
  }

  return result;
}

function compareVersions(oldInfo: VersionInfo, newInfo: VersionInfo): { isNewer: boolean, changeType: string, significance: number } {
  // If no version info available, compare by other means
  if (!oldInfo.version && !oldInfo.build && !newInfo.version && !newInfo.build) {
    return { isNewer: false, changeType: 'unknown', significance: 0 };
  }

  // Compare semantic versions
  if (oldInfo.version && newInfo.version) {
    const oldParts = oldInfo.version.split('.').map(Number);
    const newParts = newInfo.version.split('.').map(Number);
    
    for (let i = 0; i < Math.max(oldParts.length, newParts.length); i++) {
      const oldPart = oldParts[i] || 0;
      const newPart = newParts[i] || 0;
      
      if (newPart > oldPart) {
        const significance = i === 0 ? 3 : i === 1 ? 2 : 1; // Major.Minor.Patch significance
        return { isNewer: true, changeType: 'version', significance };
      } else if (newPart < oldPart) {
        return { isNewer: false, changeType: 'version', significance: 0 };
      }
    }
  }

  // Compare build numbers
  if (oldInfo.build && newInfo.build) {
    const oldBuild = parseInt(oldInfo.build);
    const newBuild = parseInt(newInfo.build);
    
    if (newBuild > oldBuild) {
      return { isNewer: true, changeType: 'build', significance: 1 };
    } else if (newBuild < oldBuild) {
      return { isNewer: false, changeType: 'build', significance: 0 };
    }
  }

  // Compare release types (Alpha < Beta < RC < Final)
  const releaseTypePriority = { 'Dev': 0, 'Alpha': 1, 'Beta': 2, 'Preview': 2, 'RC': 3, 'Final': 4, 'Stable': 4 };
  const oldPriority = releaseTypePriority[oldInfo.releaseType as keyof typeof releaseTypePriority] || 4;
  const newPriority = releaseTypePriority[newInfo.releaseType as keyof typeof releaseTypePriority] || 4;
  
  if (newPriority > oldPriority) {
    return { isNewer: true, changeType: 'release_type', significance: 2 };
  }

  // Check for new update types
  if (newInfo.updateType && newInfo.updateType !== oldInfo.updateType) {
    const updateSignificance = newInfo.updateType === 'Hotfix' ? 2 : 
                              newInfo.updateType === 'DLC' || newInfo.updateType === 'Expansion' ? 3 : 1;
    return { isNewer: true, changeType: 'update_type', significance: updateSignificance };
  }

  return { isNewer: false, changeType: 'none', significance: 0 };
}

function isSignificantUpdate(oldTitle: string, newTitle: string, oldLink: string, newLink: string): UpdateResult {
  // Different links usually mean different posts/versions
  if (oldLink !== newLink) {
    const oldInfo = extractVersionInfo(oldTitle);
    const newInfo = extractVersionInfo(newTitle);
    const comparison = compareVersions(oldInfo, newInfo);
    
    return {
      isUpdate: comparison.isNewer || comparison.significance > 0,
      details: {
        oldVersion: oldInfo,
        newVersion: newInfo,
        comparison,
        reason: oldLink !== newLink ? 'different_link' : comparison.changeType
      }
    };
  }

  return { isUpdate: false, details: null };
}

// Enhanced game matching with Steam API fallback for low confidence matches
async function enhanceGameMatchingWithSteam(
  originalTitle: string, 
  candidates: GameSearchResult[], 
  minConfidence: number = 0.8
): Promise<Array<GameSearchResult & { steamEnhanced?: boolean; steamConfidence?: number }>> {
  const enhancedCandidates = [...candidates];
  
  // Check if we have any high-confidence matches
  const highConfidenceMatch = candidates.find(candidate => 
    calculateGameSimilarity(originalTitle, candidate.title) >= minConfidence
  );
  
  // If we have high confidence matches, no need for Steam API fallback
  if (highConfidenceMatch) {
    console.log(`🎮 High confidence match found for "${originalTitle}", skipping Steam API`);
    return enhancedCandidates;
  }
  
  try {
    console.log(`🎮 Low confidence matches for "${originalTitle}", trying Steam API fallback...`);
    
    // Extract base title for better Steam matching
    const baseTitle = extractVersionInfo(originalTitle).baseTitle;
    const searchTitle = baseTitle || originalTitle;
    
    // Try to find matches using Steam API
    const steamMatches = await findSteamMatches(searchTitle, 0.6, 3);
    
    if (steamMatches.length > 0) {
      console.log(`🎮 Steam API found ${steamMatches.length} potential matches for "${searchTitle}"`);
      
      // Convert Steam matches to GameSearchResult format and add to candidates
      for (const steamMatch of steamMatches) {
        // Check if we already have this game in candidates
        const existingMatch = enhancedCandidates.find(candidate => 
          calculateGameSimilarity(candidate.title, steamMatch.name) > 0.9
        );
        
        if (!existingMatch && steamMatch.confidence > 0.7) {
          // Add Steam match as a new candidate
          const steamCandidate: GameSearchResult & { steamEnhanced?: boolean; steamConfidence?: number } = {
            id: steamMatch.appid,
            title: steamMatch.name,
            link: `https://store.steampowered.com/app/${steamMatch.appid}`,
            date: steamMatch.release_date?.date || new Date().toISOString(),
            image: steamMatch.header_image,
            description: decodeHtmlEntities(steamMatch.short_description || steamMatch.detailed_description || ''),
            source: 'steam',
            downloadLinks: [], // Steam doesn't provide direct download links
            steamEnhanced: true,
            steamConfidence: steamMatch.confidence
          };
          
          enhancedCandidates.push(steamCandidate);
          console.log(`🎮 Added Steam match: "${steamMatch.name}" (confidence: ${steamMatch.confidence.toFixed(2)})`);
        }
      }
      
      // Re-sort candidates by Steam confidence and similarity
      enhancedCandidates.sort((a, b) => {
        const aConfidence = ('steamConfidence' in a && typeof a.steamConfidence === 'number') ? a.steamConfidence : 0;
        const bConfidence = ('steamConfidence' in b && typeof b.steamConfidence === 'number') ? b.steamConfidence : 0;
        const aSimilarity = calculateGameSimilarity(originalTitle, a.title);
        const bSimilarity = calculateGameSimilarity(originalTitle, b.title);
        
        // Prioritize Steam-enhanced matches with high confidence
        if ('steamEnhanced' in a && aConfidence > 0.8) return -1;
        if ('steamEnhanced' in b && bConfidence > 0.8) return 1;
        
        // Then sort by similarity
        return bSimilarity - aSimilarity;
      });
      
    } else {
      console.log(`🎮 Steam API found no suitable matches for "${searchTitle}"`);
    }
    
  } catch (error) {
    console.error(`🎮 Steam API fallback failed for "${originalTitle}":`, error);
    // Continue with original candidates if Steam API fails
  }
  
  return enhancedCandidates;
}

/**
 * Validate an update using stored Steam verification data
 * This cross-checks potential updates against verified Steam game information
 */
async function validateUpdateWithSteamData(
  trackedGame: { steamVerified?: boolean; steamAppId?: number; steamName?: string; title: string },
  potentialUpdate: GameSearchResult,
  confidence: number
): Promise<{ isValidated: boolean; confidence: number; reason: string }> {
  // Only use Steam validation if the game has been Steam-verified
  if (!trackedGame.steamVerified || !trackedGame.steamAppId || !trackedGame.steamName) {
    return {
      isValidated: false,
      confidence,
      reason: 'No Steam verification data available'
    };
  }

  try {
    const updateTitleCleaned = cleanGameTitle(potentialUpdate.title);
    const storedSteamNameCleaned = cleanGameTitle(trackedGame.steamName);
    
    // Calculate similarity between potential update and verified Steam name
    const steamSimilarity = calculateGameSimilarity(updateTitleCleaned, storedSteamNameCleaned);
    
    console.log(`🎮 Steam Validation: "${potentialUpdate.title}" vs stored "${trackedGame.steamName}" = ${Math.round(steamSimilarity * 100)}%`);
    
    if (steamSimilarity >= 0.8) {
      // High similarity with Steam-verified name - boost confidence significantly
      const boostedConfidence = Math.min(0.95, confidence + 0.3);
      return {
        isValidated: true,
        confidence: boostedConfidence,
        reason: `Validated against Steam: "${trackedGame.steamName}" (${Math.round(steamSimilarity * 100)}% match)`
      };
    } else if (steamSimilarity >= 0.6) {
      // Moderate similarity - provide some confidence boost but still flag for review
      const moderateBoost = Math.min(0.85, confidence + 0.15);
      return {
        isValidated: true,
        confidence: moderateBoost,
        reason: `Partial Steam validation: "${trackedGame.steamName}" (${Math.round(steamSimilarity * 100)}% match) - review recommended`
      };
    } else {
      // Low similarity with Steam data - this might not be a valid update
      return {
        isValidated: false,
        confidence: Math.max(0.2, confidence - 0.2), // Reduce confidence
        reason: `Steam validation failed: Low similarity with verified name "${trackedGame.steamName}" (${Math.round(steamSimilarity * 100)}%)`
      };
    }
    
  } catch (error) {
    console.error(`Steam validation error for ${trackedGame.title}:`, error);
    return {
      isValidated: false,
      confidence,
      reason: 'Steam validation error occurred'
    };
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get user with sequel preferences
    const userWithPrefs = await User.findById(user.id);
    const sequelPrefs = userWithPrefs?.preferences?.sequelDetection || {
      enabled: true,
      sensitivity: 'moderate',
      notifyImmediately: true
    };

    // Get all active tracked games for this user
    const trackedGames = await TrackedGame.find({ 
      userId: user.id,
      isActive: true 
    });
    
    if (trackedGames.length === 0) {
      return NextResponse.json({ 
        message: 'No games to check',
        checked: 0,
        updatesFound: 0,
        sequelsFound: 0
      });
    }

    let updatesFound = 0;
    let sequelsFound = 0;
    let errors = 0;
    const API_BASE = 'https://gameapi.a7a8524.workers.dev';
    const updateDetails: Array<{ 
      title: string; 
      version: string; 
      changeType: string;
      significance: number;
      updateType: string;
      link: string;
      details: string;
    }> = [];

    for (const game of trackedGames) {
      try {
        // Enhanced search with multiple strategies
        const searchQueries = [
          game.title,
          extractVersionInfo(game.title).baseTitle,
          game.originalTitle || game.title
        ].filter((query, index, array) => array.indexOf(query) === index);

        let bestMatch: GameSearchResult | null = null;
        let bestSimilarity = 0;
        const allCandidates: GameSearchResult[] = [];

        // Search across all sites for comprehensive update checking
        for (const site of SITE_VALUES) {
          for (const query of searchQueries) {
            const searchResponse = await fetch(
              `${API_BASE}/search?query=${encodeURIComponent(query)}&site=${site}&limit=10`
            );
          
          if (!searchResponse.ok) continue;
          
          const searchData = await searchResponse.json();
          const games = searchData.results || [];
          
          // Collect all candidates for Steam API enhancement
          allCandidates.push(...games);
          
          // Check for sequels if enabled
          if (sequelPrefs.enabled) {
            const sequelThreshold = getSequelThreshold(sequelPrefs.sensitivity);
            
            for (const currentGame of games) {
              const sequelResult = detectSequel(game.title, currentGame.title);
              
              if (sequelResult && sequelResult.isSequel && sequelResult.confidence >= sequelThreshold) {
                // Check if we already have this sequel notification
                const existingSequel = game.sequelNotifications?.find((notification: { gameId: string }) => 
                  notification.gameId === currentGame.id
                );
                
                if (!existingSequel) {
                  const sequelNotification = {
                    detectedTitle: currentGame.title,
                    gameId: currentGame.id,
                    gameLink: currentGame.link,
                    image: currentGame.image || '',
                    description: currentGame.description || '',
                    source: currentGame.source,
                    similarity: sequelResult.similarity,
                    sequelType: sequelResult.sequelType,
                    dateFound: new Date(),
                    downloadLinks: currentGame.downloadLinks || []
                  };
                  
                  await TrackedGame.findByIdAndUpdate(game._id, {
                    $push: { sequelNotifications: sequelNotification }
                  });
                  
                  // Send sequel notification to the user
                  try {
                    const notificationData = createUpdateNotificationData(
                      game.title,
                      {
                        gameLink: currentGame.link,
                        image: currentGame.image
                      },
                      'sequel'
                    );
                    
                    await sendUpdateNotification(game.userId.toString(), notificationData);
                    console.log(`📢 Sequel notification sent for ${game.title} -> ${currentGame.title} to user ${game.userId}`);
                  } catch (notificationError) {
                    console.error(`Failed to send sequel notification for ${game.title}:`, notificationError);
                    // Don't fail the whole operation if notification fails
                  }
                  
                  sequelsFound++;
                }
              }
            }
          }
        }
      }

        // Reduce candidates to the most recent posts only:
        // group by link (fallback to id/title) and keep only the newest entry per group,
        // then only keep the single newest candidate overall so we check the latest update.
        if (allCandidates.length > 0) {
          try {
            const latestMap = new Map<string, typeof allCandidates[number]>();
            for (const cand of allCandidates) {
              const key = cand.link || cand.id || cand.title;
              const candDate = cand.date ? new Date(cand.date) : new Date(0);
              const existing = latestMap.get(key);
              if (!existing) {
                latestMap.set(key, cand);
              } else {
                const existingDate = existing.date ? new Date(existing.date) : new Date(0);
                if (candDate > existingDate) {
                  latestMap.set(key, cand);
                }
              }
            }

            const reducedCandidates = Array.from(latestMap.values());
            // Instead of keeping only one overall newest candidate, keep the newest candidate per source/site.
            // This helps preserve one recent post from each site while avoiding duplicates from the same source.
            const perSource = new Map<string, typeof reducedCandidates[number]>();
            for (const cand of reducedCandidates) {
              const src = cand.source || 'unknown';
              const existing = perSource.get(src);
              const candDate = cand.date ? new Date(cand.date) : new Date(0);
              // Prefer the candidate with higher similarity for this tracked game
              const candSim = calculateGameSimilarity(game.title, cand.title);
              if (!existing) {
                perSource.set(src, cand);
              } else {
                const existingDate = existing.date ? new Date(existing.date) : new Date(0);
                const existingSim = calculateGameSimilarity(game.title, existing.title);
                if (candSim > existingSim) {
                  perSource.set(src, cand);
                } else if (candSim === existingSim && candDate > existingDate) {
                  perSource.set(src, cand);
                }
              }
            }

            const kept = Array.from(perSource.values());
            // Sort by date desc so that higher-confidence flow later can still inspect recency
            kept.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));

            allCandidates.length = 0;
            allCandidates.push(...kept);
          } catch (groupErr) {
            console.error('Failed to reduce candidates to latest only:', groupErr);
            // fall back to original allCandidates on error
          }
        }

        // Compute best match from the reduced candidate list (only newest candidate present)
        if (allCandidates.length > 0) {
          for (const candidate of allCandidates) {
            const similarity = calculateGameSimilarity(game.title, candidate.title);
            if (similarity > bestSimilarity && similarity > 0.6) {
              bestMatch = candidate;
              bestSimilarity = similarity;
            }
          }
        }

        // Enhanced matching with Steam API fallback for low confidence matches
        if (bestSimilarity < 0.8 && allCandidates.length > 0) {
          console.log(`🎮 Low confidence match (${bestSimilarity.toFixed(2)}) for "${game.title}", enhancing with Steam API...`);
          
          try {
            const enhancedCandidates = await enhanceGameMatchingWithSteam(
              game.title, 
              allCandidates, 
              0.8
            );
            
            // Re-evaluate best match after Steam enhancement
            for (const candidate of enhancedCandidates) {
              const similarity = calculateGameSimilarity(game.title, candidate.title);
              const steamConfidence = ('steamConfidence' in candidate && typeof candidate.steamConfidence === 'number') ? candidate.steamConfidence : 0;
              
              // Boost similarity score for Steam-enhanced matches
              const adjustedSimilarity = ('steamEnhanced' in candidate && candidate.steamEnhanced)
                ? Math.max(similarity, steamConfidence * 0.9)
                : similarity;
              
              if (adjustedSimilarity > bestSimilarity && adjustedSimilarity > 0.6) {
                bestMatch = candidate;
                bestSimilarity = adjustedSimilarity;
                
                if ('steamEnhanced' in candidate && candidate.steamEnhanced) {
                  console.log(`🎮 Using Steam-enhanced match: "${candidate.title}" (similarity: ${adjustedSimilarity.toFixed(2)})`);
                }
              }
            }
          } catch (steamError) {
            console.error(`Steam API enhancement failed for ${game.title}:`, steamError);
            // Continue with original best match
          }
        }

        if (!bestMatch) {
          // Update last checked even if no match found
          await TrackedGame.findByIdAndUpdate(game._id, {
            lastChecked: new Date()
          });
          continue;
        }

        // Enhanced update detection
        const updateResult = isSignificantUpdate(
          game.title, 
          bestMatch.title, 
          game.gameLink, 
          bestMatch.link
        );

        if (updateResult.isUpdate) {
          const versionInfo = extractVersionInfo(bestMatch.title);
          const oldVersionInfo = extractVersionInfo(game.title);
          
          // Create detailed version string
          let versionString = '';
          if (versionInfo.version) versionString += `v${versionInfo.version}`;
          if (versionInfo.build) versionString += (versionString ? ' ' : '') + `Build ${versionInfo.build}`;
          if (versionInfo.releaseType) versionString += (versionString ? ' ' : '') + versionInfo.releaseType;
          if (versionInfo.updateType) versionString += (versionString ? ' ' : '') + `(${versionInfo.updateType})`;
          if (!versionString) versionString = 'New Version';
          
          // Check if this needs user confirmation (ambiguous update)
          let finalSimilarity = bestSimilarity;
          let finalReason = '';
          let steamValidation = null;
          
          // Use Steam validation if available and confidence is low
          if (bestSimilarity < 0.8 || versionInfo.needsUserConfirmation) {
            steamValidation = await validateUpdateWithSteamData(game, bestMatch, bestSimilarity);
            finalSimilarity = steamValidation.confidence;
            
            console.log(`🎮 Steam validation result for "${game.title}": ${steamValidation.isValidated ? 'VALIDATED' : 'NOT VALIDATED'} (${Math.round(steamValidation.confidence * 100)}%)`);
          }
          
          if (versionInfo.needsUserConfirmation || finalSimilarity < 0.8 || !versionInfo.version) {
            // Determine reason for pending status
            if (versionInfo.needsUserConfirmation) {
              finalReason = 'No clear version info - needs manual confirmation';
            } else if (finalSimilarity < 0.8) {
              finalReason = `Low similarity match (${Math.round(finalSimilarity * 100)}%)`;
            } else {
              finalReason = 'Ambiguous update - manual review recommended';
            }
            
            // Add Steam validation information to the reason
            if (steamValidation) {
              finalReason = `${finalReason} | ${steamValidation.reason}`;
            }
            
            // Check if this was enhanced by Steam API
            const isSteamEnhanced = bestMatch && 'steamEnhanced' in bestMatch && bestMatch.steamEnhanced;
            if (isSteamEnhanced) {
              const steamConfidence = ('steamConfidence' in bestMatch && typeof bestMatch.steamConfidence === 'number') ? bestMatch.steamConfidence : 0;
              finalReason += ` | Enhanced by Steam API (confidence: ${Math.round(steamConfidence * 100)}%)`;
            }
            
            // Check if Steam validation boosted confidence enough for auto-approval
            if (steamValidation && steamValidation.isValidated && finalSimilarity >= 0.8 && versionInfo.version) {
              console.log(`🎮 Steam validation boosted confidence for "${game.title}" - auto-approving update`);
              // Proceed with auto-approval instead of pending
            } else {
              // Store as pending update for user confirmation
              const pendingUpdate = {
                detectedVersion: versionInfo.version || '',
                build: versionInfo.build || '',
                releaseType: versionInfo.releaseType || '',
                updateType: versionInfo.updateType || '',
                sceneGroup: versionInfo.sceneGroup || '',
                newTitle: bestMatch.title,
                newLink: bestMatch.link,
                newImage: bestMatch.image || '',
                dateFound: new Date(),
                confidence: finalSimilarity,
                reason: finalReason,
                downloadLinks: bestMatch.downloadLinks || [],
                steamEnhanced: isSteamEnhanced || false,
                steamAppId: isSteamEnhanced ? bestMatch.id : undefined,
                steamValidated: steamValidation?.isValidated || false
              };

              await TrackedGame.findByIdAndUpdate(game._id, {
                $push: { pendingUpdates: pendingUpdate },
                lastChecked: new Date()
              });

              updateDetails.push({
                title: game.title,
                version: versionString,
                changeType: 'pending_confirmation',
                significance: 0,
                updateType: 'Pending Confirmation',
                link: bestMatch.link,
                details: finalReason
              });

              console.log(`⏳ Found pending update for "${game.title}": ${bestMatch.title} (confidence: ${Math.round(finalSimilarity * 100)}%)`);
              continue; // Skip to next game
            }
          }
          
          // Auto-approve confident updates or Steam-validated updates
          const updateResult = isSignificantUpdate(
            game.lastKnownVersion || game.title,
            bestMatch.title,
            game.gameLink,
            bestMatch.link
          );

          if (updateResult.isUpdate) {
            // Auto-confirm update with high confidence or Steam validation
            const isSteamEnhanced = bestMatch && 'steamEnhanced' in bestMatch && bestMatch.steamEnhanced;
            
            const newUpdate = {
              version: versionString,
              build: versionInfo.build || '',
              releaseType: versionInfo.releaseType || '',
              updateType: versionInfo.updateType || '',
              changeType: updateResult.details?.comparison?.changeType || 'unknown',
              significance: updateResult.details?.comparison?.significance || 1,
              dateFound: new Date(),
              gameLink: bestMatch.link,
              previousVersion: game.lastKnownVersion || 'Unknown',
              versionDetails: {
                old: oldVersionInfo,
                new: versionInfo
              },
              downloadLinks: bestMatch.downloadLinks || [],
              steamEnhanced: isSteamEnhanced || false,
              steamAppId: isSteamEnhanced ? bestMatch.id : undefined
            };

            await TrackedGame.findByIdAndUpdate(game._id, {
              $push: { updateHistory: newUpdate },
              lastKnownVersion: versionString,
              lastVersionDate: bestMatch.date || new Date().toISOString(),
              lastChecked: new Date(),
              gameLink: bestMatch.link,
              title: bestMatch.title // Update title if it's more current
            });

            // Send update notification to the user
            try {
              const notificationData = createUpdateNotificationData(
                game.title,
                {
                  version: versionString + (isSteamEnhanced ? ' (Steam Enhanced)' : ''),
                  gameLink: bestMatch.link,
                  image: bestMatch.image
                },
                'update'
              );
              
              await sendUpdateNotification(game.userId.toString(), notificationData);
              console.log(`📢 Update notification sent for ${game.title} to user ${game.userId}${isSteamEnhanced ? ' (Steam Enhanced)' : ''}`);
            } catch (notificationError) {
              console.error(`Failed to send update notification for ${game.title}:`, notificationError);
              // Don't fail the whole operation if notification fails
            }

            updateDetails.push({
              title: game.title,
              version: versionString + (isSteamEnhanced ? ' (Steam)' : ''),
              changeType: newUpdate.changeType,
              significance: newUpdate.significance,
              updateType: versionInfo.updateType || 'Update',
              link: bestMatch.link,
              details: `${oldVersionInfo.version || 'Unknown'} → ${versionInfo.version || versionInfo.build || 'New'}${isSteamEnhanced ? ' (Steam Enhanced)' : ''}`
            });
          }

          updatesFound++;
        } else {
          // Just update last checked
          await TrackedGame.findByIdAndUpdate(game._id, {
            lastChecked: new Date()
          });
        }

        // Respectful rate limiting
        await new Promise(resolve => setTimeout(resolve, 250));

      } catch (error) {
        console.error(`Error checking game ${game.title}:`, error);
        errors++;
        // Update last checked even on error
        await TrackedGame.findByIdAndUpdate(game._id, {
          lastChecked: new Date()
        });
      }
    }

    return NextResponse.json({
      message: 'Update check completed',
      checked: trackedGames.length,
      updatesFound,
      sequelsFound,
      errors,
      updateDetails: updateDetails.slice(0, 5), // Limit response size
      sequelDetectionEnabled: sequelPrefs.enabled,
      steamApiUsed: true,
      steamApiNote: 'Steam API used for enhanced game matching when confidence is low'
    });

  } catch (error) {
    console.error('Update check error:', error);
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
    console.error('Get update status error:', error);
    return NextResponse.json(
      { error: 'Failed to get update status' },
      { status: 500 }
    );
  }
}