import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// GET: Get recent updates for the current user
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

    // Get games with update history, sorted by most recent updates
    const gamesWithUpdates = await TrackedGame.aggregate([
      {
        $match: {
          userId: user.id,
          isActive: true,
          'updateHistory.0': { $exists: true } // Has at least one update
        }
      },
      {
        $addFields: {
          // Get the most recent update date
          lastUpdateDate: { $max: '$updateHistory.dateFound' },
          totalUpdates: { $size: { $ifNull: ['$updateHistory', []] } },
          // Get current version from the most recent update or lastKnownVersion
          currentVersion: {
            $ifNull: [
              '$lastKnownVersion',
              { $arrayElemAt: ['$updateHistory.version', -1] }
            ]
          }
        }
      },
      {
        $sort: { lastUpdateDate: -1 }
      },
      {
        $limit: 50 // Limit to 50 most recent
      },
      {
        $project: {
          title: 1,
          originalTitle: 1,
          steamName: 1,
          steamVerified: 1,
          image: 1,
          source: 1,
          currentVersion: 1,
          lastVersionDate: 1,
          totalUpdates: 1,
          updateHistory: {
            $slice: [
              {
                $sortArray: {
                  input: '$updateHistory',
                  sortBy: { dateFound: -1 }
                }
              },
              5 // Get last 5 updates for each game
            ]
          }
        }
      }
    ]);

    return NextResponse.json({
      success: true,
      games: gamesWithUpdates
    });

  } catch (error) {
    console.error('Error fetching recent updates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent updates' },
      { status: 500 }
    );
  }
}