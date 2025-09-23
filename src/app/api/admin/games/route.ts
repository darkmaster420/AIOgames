import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// GET: Get all tracked games for admin dashboard
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Check if user is admin (for now, any authenticated user)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const source = searchParams.get('source') || '';
    const steamVerified = searchParams.get('steamVerified');

    // Build filter query
    const filter: Record<string, unknown> = {};
    
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { originalTitle: { $regex: search, $options: 'i' } },
        { steamName: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (source) {
      filter.source = source;
    }
    
    if (steamVerified !== null && steamVerified !== undefined) {
      filter.steamVerified = steamVerified === 'true';
    }

    // Get tracked games with user info
    const trackedGames = await TrackedGame.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          _id: 1,
          gameId: 1,
          title: 1,
          originalTitle: 1,
          source: 1,
          image: 1,
          description: 1,
          gameLink: 1,
          steamVerified: 1,
          steamAppId: 1,
          steamName: 1,
          buildNumberVerified: 1,
          currentBuildNumber: 1,
          buildNumberSource: 1,
          versionNumberVerified: 1,
          currentVersionNumber: 1,
          versionNumberSource: 1,
          dateAdded: 1,
          lastChecked: 1,
          isActive: 1,
          'user._id': 1,
          'user.name': 1,
          'user.email': 1,
          updateHistoryCount: { $size: { $ifNull: ['$updateHistory', []] } }
        }
      },
      { $sort: { dateAdded: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]);

    // Get total count for pagination
    const totalCount = await TrackedGame.aggregate([
      { $match: filter },
      { $count: 'total' }
    ]);

    const total = totalCount[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      games: trackedGames,
      pagination: {
        currentPage: page,
        totalPages,
        totalGames: total,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching admin games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tracked games' },
      { status: 500 }
    );
  }
}

// DELETE: Remove a tracked game (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const gameObjectId = searchParams.get('gameObjectId');

    if (!gameObjectId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find and delete the tracked game
    const deletedGame = await TrackedGame.findByIdAndDelete(gameObjectId);

    if (!deletedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    console.log(`🗑️ Admin deleted tracked game: "${deletedGame.title}" (${deletedGame.gameId}) by admin user ${user.id}`);

    return NextResponse.json({
      success: true,
      message: 'Tracked game deleted successfully',
      deletedGame: {
        id: deletedGame._id,
        title: deletedGame.title,
        gameId: deletedGame.gameId,
        source: deletedGame.source
      }
    });

  } catch (error) {
    console.error('Error deleting tracked game:', error);
    return NextResponse.json(
      { error: 'Failed to delete tracked game' },
      { status: 500 }
    );
  }
}