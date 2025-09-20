import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel, getSequelThreshold } from '../../../../utils/sequelDetection';

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
  // Remove scene group tags for better matching
  const cleanTitle = (title: string) => {
    return title
      .toLowerCase()
      .replace(/-[A-Z0-9]{3,}/g, '') // Remove scene groups like -TENOKE, -CODEX
      .replace(/\[[^\]]*\]/g, '')    // Remove bracketed content
      .replace(/\([^)]*\)/g, '')     // Remove parenthetical content
      .replace(/[^\w\s]/g, '')       // Remove special characters
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim();
  };

  const clean1 = cleanTitle(title1);
  const clean2 = cleanTitle(title2);
  
  if (clean1 === clean2) return 1.0;
  
  // Check for substring matches
  if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.8;
  
  // Split into words and check overlap
  const words1 = clean1.split(/\s+/);
  const words2 = clean2.split(/\s+/);
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

  // Clean up base title by removing common patterns
  result.baseTitle = result.baseTitle
    .replace(/\[[^\]]*\]/g, '') // Remove bracketed content
    .replace(/\([^)]*\)/g, '')  // Remove parenthetical content
    .replace(/\s+/g, ' ')       // Normalize whitespace
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

        for (const query of searchQueries) {
          const searchResponse = await fetch(
            `${API_BASE}/search?query=${encodeURIComponent(query)}&limit=10`
          );
          
          if (!searchResponse.ok) continue;
          
          const searchData = await searchResponse.json();
          const games = searchData.results || [];
          
          // Find the best matching game for updates
          for (const currentGame of games) {
            const similarity = calculateGameSimilarity(game.title, currentGame.title);
            if (similarity > bestSimilarity && similarity > 0.6) {
              bestMatch = currentGame;
              bestSimilarity = similarity;
            }
          }
          
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
                  
                  sequelsFound++;
                }
              }
            }
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
          if (versionInfo.needsUserConfirmation || bestSimilarity < 0.8 || !versionInfo.version) {
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
              confidence: bestSimilarity,
              reason: versionInfo.needsUserConfirmation 
                ? 'No clear version info - needs manual confirmation'
                : bestSimilarity < 0.8 
                  ? `Low similarity match (${Math.round(bestSimilarity * 100)}%)`
                  : 'Ambiguous update - manual review recommended',
              downloadLinks: bestMatch.downloadLinks || []
            };

            await TrackedGame.findByIdAndUpdate(game._id, {
              $push: { pendingUpdates: pendingUpdate },
              lastChecked: new Date()
            });

            updateDetails.push({
              title: game.title,
              version: versionString + ' (PENDING)',
              changeType: 'pending_confirmation',
              significance: 0,
              updateType: 'Pending Confirmation',
              link: bestMatch.link,
              details: `Needs user confirmation - ${pendingUpdate.reason}`
            });
          } else {
            // Auto-confirm update with high confidence
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
              downloadLinks: bestMatch.downloadLinks || []
            };

            await TrackedGame.findByIdAndUpdate(game._id, {
              $push: { updateHistory: newUpdate },
              lastKnownVersion: versionString,
              lastVersionDate: bestMatch.date || new Date().toISOString(),
              lastChecked: new Date(),
              gameLink: bestMatch.link,
              title: bestMatch.title // Update title if it's more current
            });

            updateDetails.push({
              title: game.title,
              version: versionString,
              changeType: newUpdate.changeType,
              significance: newUpdate.significance,
              updateType: versionInfo.updateType || 'Update',
              link: bestMatch.link,
              details: `${oldVersionInfo.version || 'Unknown'} → ${versionInfo.version || versionInfo.build || 'New'}`
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
      sequelDetectionEnabled: sequelPrefs.enabled
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