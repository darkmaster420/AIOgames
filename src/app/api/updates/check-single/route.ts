import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel } from '../../../../utils/sequelDetection';
import { cleanGameTitle, cleanGameTitlePreserveEdition, decodeHtmlEntities } from '../../../../utils/steamApi';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';

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

interface SequelNotification {
  originalGame: string;
  sequelTitle: string;
  sequelLink?: string;
  confidence?: number;
  dateFound?: Date;
  source?: string;
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

// Enhanced game matching and update detection
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
  const cleanTitle = cleanGameTitle(title);
  
  // Extract version patterns
  const versionPatterns = [
    /v(\d+(?:\.\d+)*)/i,
    /version\s*(\d+(?:\.\d+)*)/i,
    /(\d+(?:\.\d+){1,3})/,
  ];
  
  // Extract build patterns  
  const buildPatterns = [
    /build\s*(\d+)/i,
    /b(\d{4,})/i,
  ];
  
  // Extract release type
  const releaseTypes = ['REPACK', 'PROPER', 'REAL PROPER', 'UNCUT', 'EXTENDED', 'DIRECTORS CUT', 'COMPLETE', 'GOTY', 'DEFINITIVE', 'ENHANCED'];
  const updateTypes = ['UPDATE', 'HOTFIX', 'PATCH', 'DLC', 'EXPANSION'];
  
  let version = '';
  let build = '';
  let releaseType = 'STANDARD';
  let updateType = 'FULL';
  let confidence = 0.5;
  
  // Find version
  for (const pattern of versionPatterns) {
    const match = title.match(pattern);
    if (match) {
      version = match[1];
      confidence += 0.2;
      break;
    }
  }
  
  // Find build
  for (const pattern of buildPatterns) {
    const match = title.match(pattern);
    if (match) {
      build = match[1];
      confidence += 0.1;
      break;
    }
  }
  
  // Find release type
  for (const type of releaseTypes) {
    if (title.toUpperCase().includes(type)) {
      releaseType = type;
      confidence += 0.1;
      break;
    }
  }
  
  // Find update type
  for (const type of updateTypes) {
    if (title.toUpperCase().includes(type)) {
      updateType = type;
      confidence += 0.1;
      break;
    }
  }
  
  return {
    version,
    build,
    releaseType,
    updateType,
    baseTitle: cleanTitle,
    fullVersionString: title,
    confidence,
    needsUserConfirmation: confidence < 0.7
  };
}

function compareVersions(oldVersion: VersionInfo, newVersion: VersionInfo): { isNewer: boolean; changeType: string; significance: number } {
  let isNewer = false;
  let changeType = 'unknown';
  let significance = 0;
  
  // Compare versions if both have them
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
        } else {
          changeType = 'patch';
          significance = 2;
        }
        break;
      } else if (newPart < oldPart) {
        break; // Older version
      }
    }
  }
  
  // Compare builds if both have them
  if (oldVersion.build && newVersion.build && !isNewer) {
    const oldBuild = parseInt(oldVersion.build);
    const newBuild = parseInt(newVersion.build);
    
    if (newBuild > oldBuild) {
      isNewer = true;
      changeType = 'build';
      significance = 1;
    }
  }
  
  // Check for different release types
  if (newVersion.releaseType !== oldVersion.releaseType && newVersion.releaseType !== 'STANDARD') {
    if (['REPACK', 'PROPER', 'REAL PROPER'].includes(newVersion.releaseType)) {
      isNewer = true;
      changeType = 'repack';
      significance = Math.max(significance, 3);
    } else if (['UNCUT', 'EXTENDED', 'DIRECTORS CUT', 'COMPLETE', 'GOTY', 'DEFINITIVE', 'ENHANCED'].includes(newVersion.releaseType)) {
      isNewer = true;
      changeType = 'enhanced';
      significance = Math.max(significance, 7);
    }
  }
  
  return { isNewer, changeType, significance };
}

// POST: Check for updates for a specific game using the search API
export async function POST(request: Request) {
  try {
    await connectDB();

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { gameId } = body;

    if (!gameId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    // Find the specific game for this user
    const game = await TrackedGame.findOne({ 
      _id: gameId, 
      userId: user.id 
    });

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found or not authorized' },
        { status: 404 }
      );
    }

    console.log(`🎮 Checking updates for single game: ${game.title}`);

    let updatesFound = 0;
    let sequelsFound = 0;
    const results = [];

    // Get the clean title for searching (same approach as the search functionality)
    const cleanTitle = cleanGameTitle(game.title);
    const searchTitle = cleanGameTitlePreserveEdition(game.title);
    
    console.log(`🔍 Searching for: "${searchTitle}" (from "${game.title}")`);

    // Use the same search API that the main search uses
    const searchResponse = await fetch(`https://gameapi.a7a8524.workers.dev/?search=${encodeURIComponent(searchTitle)}`);
    
    if (!searchResponse.ok) {
      throw new Error(`Search API request failed: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    
    // Extract results from API response
    let games: GameSearchResult[] = [];
    if (searchData.success && searchData.results && Array.isArray(searchData.results)) {
      games = searchData.results;
    }
    
    console.log(`📊 Search returned ${games.length} results`);

    // Reduce results to the newest post only (group by link/id/title then take newest)
    try {
      const latestMap = new Map<string, GameSearchResult>();
      for (const g of games) {
        const key = g.link || g.id || g.title;
        const date = g.date ? new Date(g.date) : new Date(0);
        const existing = latestMap.get(key);
        if (!existing) {
          latestMap.set(key, g);
        } else {
          const existingDate = existing.date ? new Date(existing.date) : new Date(0);
          if (date > existingDate) latestMap.set(key, g);
        }
      }

      const reduced = Array.from(latestMap.values());
      // Keep newest result per source/site to avoid dropping recent posts from different sites
      const perSource = new Map<string, GameSearchResult>();
      for (const g of reduced) {
        const src = g.source || 'unknown';
        const existing = perSource.get(src);
        const date = g.date ? new Date(g.date) : new Date(0);
        if (!existing) perSource.set(src, g);
        else {
          const existingDate = existing.date ? new Date(existing.date) : new Date(0);
          if (date > existingDate) perSource.set(src, g);
        }
      }

      const kept = Array.from(perSource.values());
      kept.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));

      if (kept.length > 0) {
        games = kept; // process one newest per site (usually small number)
        console.log(`🔎 Reduced to ${kept.length} newest results across sources (kept top: ${kept[0].title})`);
      } else {
        games = [];
      }
    } catch (reduceErr) {
      console.error('Failed to reduce search results to newest only:', reduceErr);
      // fall back to original games list
    }

    // Process results to find updates and sequels
    for (const result of games) {
      const decodedTitle = decodeHtmlEntities(result.title);
      const similarity = calculateGameSimilarity(cleanTitle, decodedTitle);
      
      console.log(`🎯 Comparing "${decodedTitle}" (similarity: ${similarity.toFixed(2)})`);
      
      // Check for potential updates (high similarity)
      if (similarity >= 0.8) {
        const currentVersionInfo = extractVersionInfo(game.lastKnownVersion || game.title);
        const newVersionInfo = extractVersionInfo(decodedTitle);
        
        const comparison = compareVersions(currentVersionInfo, newVersionInfo);
        
        if (comparison.isNewer || newVersionInfo.needsUserConfirmation) {
          console.log(`✨ Potential update found: ${decodedTitle}`);
          
          // Check if we already have this update in pending
          const existingPending = game.pendingUpdates?.some((pending: PendingUpdate) => 
            pending.version === decodedTitle && pending.gameLink === result.link
          );
          
          if (!existingPending) {
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
              needsUserConfirmation: newVersionInfo.needsUserConfirmation || comparison.significance < 2
            };

            // Add to pending updates
            await TrackedGame.findByIdAndUpdate(game._id, {
              $push: { pendingUpdates: updateData },
              lastChecked: new Date()
            });

            // Send notification for the update
            try {
              const notificationData = createUpdateNotificationData(
                game.title,
                {
                  version: decodedTitle,
                  gameLink: result.link,
                  image: result.image
                },
                'update'
              );
              
              await sendUpdateNotification(game.userId.toString(), notificationData);
              console.log(`📢 Update notification sent for ${game.title} to user ${game.userId}`);
            } catch (notificationError) {
              console.error(`Failed to send update notification for ${game.title}:`, notificationError);
              // Don't fail the whole operation if notification fails
            }

            updatesFound++;
            results.push({
              gameTitle: game.title,
              update: updateData
            });
            
            console.log(`📝 Added pending update for ${game.title}: ${decodedTitle}`);
          }
        }
      }
      
      // Check for sequels (moderate similarity)
      else if (similarity >= 0.5) {
        const sequelResult = detectSequel(cleanTitle, decodedTitle);
        
        if (sequelResult && sequelResult.isSequel) {
          console.log(`🎬 Potential sequel found: ${decodedTitle}`);
          
          // Check if we already have this sequel notification
          const user = await User.findById(game.userId);
          const existingSequel = user?.sequelNotifications?.some((sequel: SequelNotification) => 
            sequel.originalGame === game.title && sequel.sequelTitle === decodedTitle
          );
          
          if (!existingSequel) {
            await User.findByIdAndUpdate(game.userId, {
              $push: {
                sequelNotifications: {
                  originalGame: game.title,
                  sequelTitle: decodedTitle,
                  sequelLink: result.link,
                  confidence: sequelResult.confidence,
                  dateFound: new Date(),
                  source: result.source
                }
              }
            });
            
            // Send notification for the sequel
            try {
              const notificationData = createUpdateNotificationData(
                game.title,
                {
                  gameLink: result.link,
                  image: result.image
                },
                'sequel'
              );
              
              await sendUpdateNotification(game.userId.toString(), notificationData);
              console.log(`📢 Sequel notification sent for ${game.title} -> ${decodedTitle} to user ${game.userId}`);
            } catch (notificationError) {
              console.error(`Failed to send sequel notification for ${game.title}:`, notificationError);
              // Don't fail the whole operation if notification fails
            }
            
            sequelsFound++;
            console.log(`📝 Added sequel notification: ${decodedTitle}`);
          }
        }
      }
    }

    // Update last checked time
    await TrackedGame.findByIdAndUpdate(game._id, {
      lastChecked: new Date()
    });

    console.log(`✅ Single game update check complete. Updates: ${updatesFound}, Sequels: ${sequelsFound}`);

    return NextResponse.json({
      success: true,
      message: `Update check complete for "${game.title}"`,
      gameTitle: game.title,
      updatesFound,
      sequelsFound,
      results
    });

  } catch (error) {
    console.error('Error checking single game updates:', error);
    return NextResponse.json(
      { error: 'Failed to check game updates' },
      { status: 500 }
    );
  }
}