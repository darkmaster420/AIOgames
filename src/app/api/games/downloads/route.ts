import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// GET: Get download links for a specific game or update
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const gameId = searchParams.get('gameId');
    const updateIndex = searchParams.get('updateIndex');
    const pendingUpdateId = searchParams.get('pendingUpdateId');

    if (!gameId) {
      return NextResponse.json(
        { error: 'gameId is required' },
        { status: 400 }
      );
    }

    await connectDB();

    const game = await TrackedGame.findOne({
      _id: gameId,
      userId: user.id
    });

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found or access denied' },
        { status: 404 }
      );
    }

    let downloadLinks: Array<{
      service: string;
      url: string;
      type: string;
    }> = [];

    let context = {
      gameTitle: game.title,
      currentVersion: game.lastKnownVersion || 'Unknown',
      type: 'current'
    };

    if (pendingUpdateId) {
      // Get download links from a pending update
      const pendingUpdate = game.pendingUpdates.find((update: {
        _id: { toString: () => string };
        downloadLinks?: Array<{
          service: string;
          url: string;
          type: string;
        }>;
        newTitle: string;
        detectedVersion: string;
      }) => 
        update._id.toString() === pendingUpdateId
      );
      
      if (pendingUpdate && pendingUpdate.downloadLinks) {
        downloadLinks = pendingUpdate.downloadLinks;
        context = {
          gameTitle: pendingUpdate.newTitle,
          currentVersion: pendingUpdate.detectedVersion || 'Pending Update',
          type: 'pending'
        };
      }
    } else if (updateIndex !== null && updateIndex !== undefined) {
      // Get download links from a specific update in history
      const index = parseInt(updateIndex);
      if (index >= 0 && index < game.updateHistory.length) {
        const update = game.updateHistory[index];
        if (update.downloadLinks) {
          downloadLinks = update.downloadLinks;
          context = {
            gameTitle: game.title,
            currentVersion: update.version,
            type: 'update'
          };
        }
      }
    } else {
      // Get download links from the most recent update
      if (game.updateHistory && game.updateHistory.length > 0) {
        const latestUpdate = game.updateHistory[game.updateHistory.length - 1];
        if (latestUpdate.downloadLinks) {
          downloadLinks = latestUpdate.downloadLinks;
          context = {
            gameTitle: game.title,
            currentVersion: latestUpdate.version,
            type: 'latest'
          };
        }
      }
    }

    // If no download links found in tracking data, try to fetch from gameapi
    if (downloadLinks.length === 0) {
      try {
        // Try to extract postId and siteType from the game's data
        let postId: string | null = null;
        let siteType: string | null = null;
        let targetSource = 'unknown';
        
        // FIRST: Try to use the gameId field (site_postid format) - this is the most reliable
        if (game.gameId) {
          const gameIdMatch = game.gameId.match(/^([a-z]+)_(.+)$/);
          if (gameIdMatch) {
            [, siteType, postId] = gameIdMatch;
            targetSource = 'gameId';
          }
        }
        
        // FALLBACK: If gameId didn't work, try to extract from URLs
        if (!postId || !siteType) {
          // Try latest update's gameLink first
          let targetUrl: string | null = null;
          if (game.updateHistory && game.updateHistory.length > 0) {
            const latestUpdate = game.updateHistory[game.updateHistory.length - 1];
            if (latestUpdate.gameLink) {
              targetUrl = latestUpdate.gameLink;
              targetSource = 'latest-update-url';
            }
          }
          
          // Fallback to the game's current gameLink
          if (!targetUrl && game.gameLink) {
            targetUrl = game.gameLink;
            targetSource = 'current-gameLink-url';
          }
          
          // Try to extract postId from URL if we have one
          if (targetUrl) {
            // Try different URL patterns based on site
            // Pattern 1: WordPress API-style URLs with ID in path (e.g., /wp-json/wp/v2/posts/12345)
            const apiMatch = targetUrl.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
            if (apiMatch) {
              postId = apiMatch[1];
            }
            
            // Pattern 2: Query parameter (e.g., ?p=12345)
            if (!postId) {
              const queryMatch = targetUrl.match(/[?&]p=(\d+)/);
              if (queryMatch) {
                postId = queryMatch[1];
              }
            }
            
            // Pattern 3: ID at the end of path (e.g., /post/12345 or /12345/)
            if (!postId) {
              const pathMatch = targetUrl.match(/\/(\d+)\/?$/);
              if (pathMatch) {
                postId = pathMatch[1];
              }
            }
            
            // Extract siteType from domain
            const domainMatch = targetUrl.match(/https?:\/\/([^\/]+)/);
            if (domainMatch) {
              const domain = domainMatch[1];
              // Map domain to siteType (use GameAPI's expected site names)
              if (domain.includes('gamedrive')) siteType = 'gamedrive';
              else if (domain.includes('skidrowreloaded')) siteType = 'skidrow';
              else if (domain.includes('freegogpcgames')) siteType = 'freegog';
              else if (domain.includes('steamrip')) siteType = 'steamrip';
              else if (domain.includes('reloadedsteam')) siteType = 'reloadedsteam';
              else if (domain.includes('steamunderground')) siteType = 'steamunderground';
            }
          }
        }
        
        if (postId && siteType) {
          console.log(`Attempting to fetch download links from gameapi: postId=${postId}, siteType=${siteType}, source=${targetSource}, gameId=${game.gameId}`);
          
          const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
          const gameapiUrl = `${baseUrl}/post?id=${encodeURIComponent(postId)}&site=${encodeURIComponent(siteType)}`;
          
          const gameapiResponse = await fetch(gameapiUrl, {
            headers: {
              'User-Agent': 'AIOGames-Tracker/1.0'
            }
          });

          if (gameapiResponse.ok) {
            const gameapiData = await gameapiResponse.json();
            
            if (gameapiData.success && gameapiData.post && gameapiData.post.downloadLinks) {
              downloadLinks = gameapiData.post.downloadLinks.map((link: {
                service: string;
                url: string;
                type: string;
              }) => ({
                service: link.service,
                url: link.url,
                type: link.type
              }));
              
              context = {
                gameTitle: game.title,
                currentVersion: context.currentVersion || 'Latest from gameapi',
                type: `gameapi-fallback-${targetSource}`
              };
              
              console.log(`Successfully fetched ${downloadLinks.length} download links from gameapi (source: ${targetSource})`);
            } else {
              console.log(`gameapi response: success=${gameapiData.success}, has post=${!!gameapiData.post}, has downloadLinks=${!!gameapiData.post?.downloadLinks}`);
            }
          } else {
            console.log(`gameapi response not ok: ${gameapiResponse.status} ${gameapiResponse.statusText}`);
          }
        } else {
          console.log(`Could not extract postId and siteType. gameId=${game.gameId}, gameLink=${game.gameLink}`);
        }
      } catch (gameapiError) {
        console.error('Failed to fetch from gameapi as fallback:', gameapiError);
        // Continue without gameapi data - not a critical error
      }
    }

    return NextResponse.json({
      gameId: game._id,
      context,
      downloadLinks: downloadLinks.map(link => ({
        service: link.service,
        url: link.url,
        type: link.type,
        displayName: formatServiceName(link.service),
        icon: getServiceIcon(link.service)
      })),
      totalLinks: downloadLinks.length
    });

  } catch (error) {
    console.error('Error fetching download links:', error);
    return NextResponse.json(
      { error: 'Failed to fetch download links' },
      { status: 500 }
    );
  }
}

// Helper function to format service names for display
function formatServiceName(service: string): string {
  const serviceNames: { [key: string]: string } = {
    'mega': 'MEGA',
    'mediafire': 'MediaFire',
    'googledrive': 'Google Drive',
    '1fichier': '1fichier',
    'rapidgator': 'RapidGator',
    'uploadhaven': 'UploadHaven',
    'torrent': 'Torrent',
    'magnet': 'Magnet Link',
    'direct': 'Direct Download'
  };
  
  return serviceNames[service.toLowerCase()] || service.charAt(0).toUpperCase() + service.slice(1);
}

// Helper function to get service icons/styles
function getServiceIcon(service: string): string {
  const serviceIcons: { [key: string]: string } = {
    'mega': '☁️',
    'mediafire': '🔥',
    'googledrive': '📁',
    '1fichier': '📄',
    'rapidgator': '⚡',
    'uploadhaven': '📤',
    'torrent': '🌊',
    'magnet': '🧲',
    'direct': '⬇️'
  };
  
  return serviceIcons[service.toLowerCase()] || '🔗';
}