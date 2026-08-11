import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
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
import {
  normalizeDownloadLinks,
  toDisplayDownloadLinks,
  type DownloadLinkLike,
} from '../../../../lib/downloadLinks';

type TrackedUpdateRow = {
  version?: string;
  dateFound?: string | Date;
  gameLink?: string;
  downloadLinks?: DownloadLinkLike[];
};

type TrackedGameDoc = {
  _id: mongoose.Types.ObjectId;
  gameId?: string;
  title?: string;
  source?: string;
  gameLink?: string;
  lastKnownVersion?: string;
  latestApprovedUpdate?: TrackedUpdateRow;
  updateHistory?: TrackedUpdateRow[];
  rssCachedDownloadLinks?: DownloadLinkLike[];
  rssDownloadLinksFetchedAt?: Date;
};

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

    if (!mongoose.Types.ObjectId.isValid(gameId)) {
      return NextResponse.json(
        { error: 'Game not found or access denied' },
        { status: 404 }
      );
    }

    // `.lean()` matters here: hydrated subdocuments cannot be safely spread,
    // and nothing on this path needs document methods.
    const game = await TrackedGame.findOne({
      _id: gameId,
      userId: user.id
    }).lean<TrackedGameDoc | null>();

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

    const history = Array.isArray(game.updateHistory) ? game.updateHistory : [];

    let downloadLinks: TrackedDownloadLink[] = [];
    let context = {
      gameTitle: game.title || 'Unknown',
      currentVersion: game.lastKnownVersion || 'Unknown',
      type: 'current'
    };

    const requestedIndex = updateIndex === null ? null : Number.parseInt(updateIndex, 10);

    if (requestedIndex !== null) {
      // Links for one specific point in update history.
      if (!Number.isInteger(requestedIndex) || requestedIndex < 0 || requestedIndex >= history.length) {
        return NextResponse.json(
          { error: 'updateIndex is out of range for this game' },
          { status: 400 }
        );
      }

      const update = history[requestedIndex];
      downloadLinks = normalizeDownloadLinks(update.downloadLinks);
      context = {
        gameTitle: game.title || 'Unknown',
        currentVersion: update.version || game.lastKnownVersion || 'Unknown',
        type: 'update'
      };
    } else {
      downloadLinks = collectStoredDownloadLinks(game);
      if (downloadLinks.length > 0 && history.length > 0) {
        const latestUpdate = [...history].sort(
          (a, b) => new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
        )[0];
        context = {
          gameTitle: game.title || 'Unknown',
          currentVersion: latestUpdate.version || game.lastKnownVersion || 'Unknown',
          type: 'latest'
        };
      }
    }

    // Nothing stored (or the requested history row carried none) — go back to
    // the source post. Only worth doing for games we can actually resolve.
    if (downloadLinks.length === 0) {
      downloadLinks = await fetchDownloadLinksViaGameapi(game);
      if (downloadLinks.length > 0) {
        context = {
          gameTitle: game.title || 'Unknown',
          currentVersion: context.currentVersion || 'Latest from source post',
          type: 'built-in-source-fallback'
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

    const displayLinks = toDisplayDownloadLinks(downloadLinks);

    return NextResponse.json({
      gameId: game._id,
      context,
      downloadLinks: displayLinks,
      totalLinks: displayLinks.length
    });

  } catch (error) {
    console.error('Error fetching download links:', error);
    return NextResponse.json(
      { error: 'Failed to fetch download links' },
      { status: 500 }
    );
  }
}
