import { NextRequest, NextResponse } from 'next/server';
import type { PipelineStage } from 'mongoose';
import mongoose from 'mongoose';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import {
  generateRSSXML,
  gamesToRSSItems,
  telegramFeedToRssItems,
  normalizeGameLinkForRssDedupe,
  type RssTelegramFeedEntryLean,
} from '../../../../utils/rssGenerator';
import logger from '../../../../utils/logger';

/**
 * GET /api/rss/feed
 * Returns an RSS feed of the current user's tracked games with download links
 *
 * Authentication:
 * - Session-based: Automatic via getCurrentUser()
 * - Token-based: Pass ?token=xxxxx query parameter
 *
 * Query parameters:
 * - token: Optional RSS feed token for token-based authentication
 * - sort: 'all' (default) | 'recent' | 'updated'
 *   - 'all': All active tracked games (best default for RSS readers)
 *   - 'recent': Only games with updates in the last 7 days
 *   - 'updated': Games that have had updates
 * - limit: Number of items to include (default: 50, max: 500)
 * - enclosures: 'torrents' (default) | 'all' — torrents: only magnet / .torrent in <enclosure> (qBittorrent); all: every link as enclosure
 *
 * Up to 10 newest items are sourced from successful Telegram update notifications (same payload as Telegram, including download links),
 * then the rest from tracked games. Telegram-head games are omitted from the tracked section when `trackedGameId` or post URL matches.
 *
 * Items are ordered by pubDate descending. Tracked-game titles use `[Updated]` when activity is newer than when the game was first tracked;
 * Telegram-sourced items are always labeled `[Updated]`.
 */
export async function GET(req: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    
    let userId: string | null = null;
    let userEmail: string | null = null;
    let userName: string | null = null;

    // Authenticate via token or session
    if (token) {
      // Token-based authentication
      const userDoc = await User.findOne({ rssFeedToken: token })
        .select('_id email name')
        .lean() as { _id: { toString(): string }; email: string; name: string } | null;

      if (!userDoc) {
        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Error</title><description>Invalid or expired RSS token</description></channel></rss>',
          {
            status: 401,
            headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' }
          }
        );
      }

      userId = userDoc._id.toString();
      userEmail = userDoc.email;
      userName = userDoc.name;
    } else {
      // Session-based authentication
      const user = await getCurrentUser();
      if (!user) {
        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Error</title><description>Unauthorized - please authenticate or provide a valid RSS token</description></channel></rss>',
          {
            status: 401,
            headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' }
          }
        );
      }

      userId = user.id;
      userEmail = user.email;
      userName = user.name;
    }

    const sortMode = searchParams.get('sort') || 'all';
    const limitParam = searchParams.get('limit');
    const limitRaw = parseInt(limitParam || '50', 10);
    const limit = Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 500);
    const enclosuresMode =
      searchParams.get('enclosures') === 'all' ? 'all' : 'torrents';

    const userFeedDoc = await User.findById(userId)
      .select('rssTelegramFeed')
      .lean() as { rssTelegramFeed?: RssTelegramFeedEntryLean[] } | null;

    const rssTelegramFeed = userFeedDoc?.rssTelegramFeed ?? [];
    const telegramHeadMax = Math.min(10, limit);
    const rawTelegramSlice = rssTelegramFeed.slice(0, telegramHeadMax);
    const telegramRssItems = telegramFeedToRssItems(rawTelegramSlice, {
      enclosures: enclosuresMode,
    });

    const excludeIds = new Set<string>();
    const excludeLinks = new Set<string>();
    for (const e of rawTelegramSlice) {
      if (e.trackedGameId != null) {
        const tid =
          typeof e.trackedGameId === 'object' &&
          e.trackedGameId !== null &&
          'toString' in e.trackedGameId
            ? (e.trackedGameId as { toString(): string }).toString()
            : String(e.trackedGameId);
        if (mongoose.Types.ObjectId.isValid(tid)) excludeIds.add(tid);
      }
      const norm = normalizeGameLinkForRssDedupe(e.gameLink);
      if (norm) excludeLinks.add(norm);
    }

    const remainingLimit = Math.max(0, limit - telegramRssItems.length);

    // Aggregate pipelines are not schema-cast by Mongoose: userId must be ObjectId or $match returns nothing.
    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : null;
    if (!userObjectId) {
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Error</title><description>Invalid user id</description></channel></rss>',
        {
          status: 400,
          headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
        }
      );
    }

    type QueryType = Record<string, unknown>;
    let query: QueryType = {
      userId: userObjectId,
      isActive: true
    };

    if (excludeIds.size > 0) {
      query = {
        ...query,
        _id: {
          $nin: [...excludeIds].map(id => new mongoose.Types.ObjectId(id)),
        },
      };
    }

    // Build query based on sort mode
    if (sortMode === 'recent') {
      // Games with updates in the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      query = {
        ...query,
        $or: [
          { 'latestApprovedUpdate.dateFound': { $gte: sevenDaysAgo } },
          { 'lastVersionDate': { $gte: sevenDaysAgo.toISOString() } },
          { 'updateHistory.dateFound': { $gte: sevenDaysAgo } }
        ]
      };
    } else if (sortMode === 'updated') {
      // Games that have at least one update
      query = {
        ...query,
        $or: [
          { updateHistory: { $exists: true, $ne: [] } },
          { latestApprovedUpdate: { $exists: true, $ne: null } }
        ]
      };
    }
    // 'all' mode uses the base query

    const pipeline: PipelineStage[] = [
      { $match: query },
      {
        $addFields: {
          _histMax: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$updateHistory', []] } }, 0] },
              {
                $max: {
                  $map: {
                    input: '$updateHistory',
                    as: 'h',
                    in: { $ifNull: ['$$h.dateFound', new Date(0)] },
                  },
                },
              },
              new Date(0),
            ],
          },
        },
      },
      {
        $addFields: {
          _lastVersionAsDate: {
            $convert: {
              input: '$lastVersionDate',
              to: 'date',
              onError: new Date(0),
              onNull: new Date(0),
            },
          },
          _pubFromTimestamp: {
            $cond: [
              { $gt: [{ $ifNull: ['$lastPubTimestamp', 0] }, 0] },
              { $toDate: { $toLong: '$lastPubTimestamp' } },
              new Date(0),
            ],
          },
        },
      },
      {
        $addFields: {
          _rssActivity: {
            $max: [
              { $ifNull: ['$dateAdded', new Date(0)] },
              { $ifNull: ['$latestApprovedUpdate.dateFound', new Date(0)] },
              '$_histMax',
              '$_lastVersionAsDate',
              '$_pubFromTimestamp',
            ],
          },
        },
      },
      { $sort: { _rssActivity: -1 } },
      { $limit: remainingLimit },
      {
        $project: {
          _histMax: 0,
          _lastVersionAsDate: 0,
          _pubFromTimestamp: 0,
        },
      },
    ];

    const trackedGames = await TrackedGame.aggregate(pipeline);

    const typedGames = (trackedGames || [])
      .map(game => ({
        ...game,
        _id:
          typeof (game._id as unknown as { toString(): string })?.toString === 'function'
            ? (game._id as unknown as { toString(): string }).toString()
            : String(game._id),
      }))
      .filter(game => {
        if (excludeIds.has(game._id)) return false;
        const norm = normalizeGameLinkForRssDedupe(
          typeof game.gameLink === 'string' ? game.gameLink : undefined
        );
        if (norm && excludeLinks.has(norm)) return false;
        return true;
      });

    if (telegramRssItems.length === 0 && typedGames.length === 0) {
      // Return empty but valid RSS feed
      const emptyFeed = {
        title: `${userName}'s Game Tracking Feed`,
        description: 'Your tracked games updates',
        link: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}`,
        language: 'en-us',
        managingEditor: userEmail,
        items: []
      };

      const xml = generateRSSXML(emptyFeed);
      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    const trackedRssItems =
      typedGames.length > 0
        ? gamesToRSSItems(typedGames as unknown as Parameters<typeof gamesToRSSItems>[0], {
            enclosures: enclosuresMode,
          })
        : [];

    const rssItems = [...telegramRssItems, ...trackedRssItems]
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, limit);

    // Build RSS feed
    const feed = {
      title: `${userName}'s Game Tracking Feed`,
      description: `Game updates for ${userName}'s tracked games from AIOgames`,
      link: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/tracking`,
      language: 'en-us',
      managingEditor: userEmail,
      items: rssItems
    };

    const xml = generateRSSXML(feed);

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });
  } catch (error) {
    logger.error('RSS feed generation error:', error);
    console.error('RSS feed error:', error);

    // Return error as XML-formatted response
    const errorXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Error</title>
    <description>Failed to generate RSS feed</description>
  </channel>
</rss>`;

    return new NextResponse(errorXml, {
      status: 500,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8'
      }
    });
  }
}
