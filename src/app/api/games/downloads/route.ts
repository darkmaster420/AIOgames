import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import {
  collectStoredDownloadLinks,
  fetchDownloadLinksViaGameapi,
  type TrackedDownloadLink
} from '../../../../lib/trackedGameDownloadLinks';
import {
  buildFollowPostDownloadResponse,
  isFollowPostTrackedGame,
  resolveTrackedGameSiteType,
} from '../../../../lib/downloadSitePolicy';

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

    if (isFollowPostTrackedGame(game)) {
      return NextResponse.json({
        gameId: game._id,
        ...buildFollowPostDownloadResponse(
          {
            title: game.title,
            gameLink: game.gameLink,
            lastKnownVersion: game.lastKnownVersion,
          },
          resolveTrackedGameSiteType(game),
        ),
      });
    }

    let downloadLinks: TrackedDownloadLink[] = [];

    let context = {
      gameTitle: game.title,
      currentVersion: game.lastKnownVersion || 'Unknown',
      type: 'current'
    };

    if (updateIndex !== null && updateIndex !== undefined) {
      // Get download links from a specific update in history
      const index = parseInt(updateIndex);
      if (index >= 0 && index < game.updateHistory.length) {
        const update = game.updateHistory[index];
        if (Array.isArray(update.downloadLinks) && update.downloadLinks.length > 0) {
          downloadLinks = update.downloadLinks;
          context = {
            gameTitle: game.title,
            currentVersion: update.version,
            type: 'update'
          };
        }
      }
    } else {
      downloadLinks = collectStoredDownloadLinks(game);
      if (downloadLinks.length > 0 && game.updateHistory?.length) {
        const latestUpdate = [...game.updateHistory].sort(
          (a: { dateFound?: string | Date }, b: { dateFound?: string | Date }) =>
            new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
        )[0];
        context = {
          gameTitle: game.title,
          currentVersion: latestUpdate.version,
          type: 'latest'
        };
      }
    }

    if (downloadLinks.length === 0) {
      downloadLinks = await fetchDownloadLinksViaGameapi(game);
      if (downloadLinks.length > 0) {
        context = {
          gameTitle: game.title,
          currentVersion: context.currentVersion || 'Latest from gameapi',
          type: 'gameapi-fallback'
        };
        await TrackedGame.updateOne(
          { _id: game._id, userId: user.id },
          {
            $set: {
              rssCachedDownloadLinks: downloadLinks,
              rssDownloadLinksFetchedAt: new Date()
            }
          }
        );
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