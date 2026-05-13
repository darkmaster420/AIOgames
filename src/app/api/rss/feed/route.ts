import { NextRequest, NextResponse } from 'next/server';
import type { PipelineStage } from 'mongoose';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { generateRSSXML, gamesToRSSItems } from '../../../../utils/rssGenerator';
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
 * - sort: 'recent' (default) | 'all' | 'updated'
 *   - 'recent': Only games with updates in the last 7 days
 *   - 'all': All active tracked games
 *   - 'updated': Games that have had updates
 * - limit: Number of items to include (default: 50, max: 500)
 * - enclosures: 'torrents' (default) | 'all' — torrents: only magnet / .torrent in <enclosure> (qBittorrent); all: every link as enclosure
 *
 * Items are ordered by most recent activity (latest approved update, history, version date, or pub timestamp), newest first.
 * Titles are prefixed with `[Updated]` when activity is newer than when the game was first tracked.
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

    const sortMode = searchParams.get('sort') || 'recent';
    const limitParam = searchParams.get('limit');
    const limit = Math.min(parseInt(limitParam || '50'), 500);
    const enclosuresMode =
      searchParams.get('enclosures') === 'all' ? 'all' : 'torrents';

    type QueryType = Record<string, unknown>;
    let query: QueryType = {
      userId,
      isActive: true
    };

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
      { $limit: limit },
      {
        $project: {
          _histMax: 0,
          _lastVersionAsDate: 0,
          _pubFromTimestamp: 0,
        },
      },
    ];

    const trackedGames = await TrackedGame.aggregate(pipeline);

    if (!trackedGames || trackedGames.length === 0) {
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

    // Convert games to RSS items
    const typedGames = trackedGames.map(game => ({
      ...game,
      _id: typeof (game._id as unknown as { toString(): string })?.toString === 'function' 
        ? (game._id as unknown as { toString(): string }).toString() 
        : String(game._id)
    }));

    const rssItems = gamesToRSSItems(
      typedGames as unknown as Parameters<typeof gamesToRSSItems>[0],
      { enclosures: enclosuresMode }
    );

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
