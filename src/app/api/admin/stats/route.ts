import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { User, TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// GET: Get admin dashboard stats
export async function GET() {
  try {
    const user = await getCurrentUser();
    
    // For now, we'll consider any user an admin. In production, you'd check user roles
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get system statistics
    const [
      totalUsers,
      totalTrackedGames,
      activeUsers,
      recentUsers,
      topTrackedGames,
      systemStats
    ] = await Promise.all([
      // Total users
      User.countDocuments(),
      
      // Total tracked games
      TrackedGame.countDocuments(),
      
      // Active users (users who have tracked games)
      User.aggregate([
        {
          $lookup: {
            from: 'trackedgames',
            localField: '_id',
            foreignField: 'userId',
            as: 'trackedGames'
          }
        },
        {
          $match: {
            'trackedGames.0': { $exists: true }
          }
        },
        {
          $count: 'activeUsers'
        }
      ]),
      
      // Recent users (last 7 days)
      User.find({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).sort({ createdAt: -1 }).limit(10),
      
      // Most tracked games
      TrackedGame.aggregate([
        {
          $group: {
            _id: '$title',
            count: { $sum: 1 },
            source: { $first: '$source' },
            image: { $first: '$image' }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 10
        }
      ]),
      
      // System stats
      TrackedGame.aggregate([
        {
          $group: {
            _id: null,
            totalUpdates: { $sum: { $size: '$updateHistory' } },
            totalPendingUpdates: { $sum: { $size: '$pendingUpdates' } },
            avgGamesPerUser: { $avg: 1 }
          }
        }
      ])
    ]);

    return NextResponse.json({
      stats: {
        totalUsers,
        totalTrackedGames,
        activeUsers: activeUsers[0]?.activeUsers || 0,
        totalUpdates: systemStats[0]?.totalUpdates || 0,
        pendingUpdates: systemStats[0]?.totalPendingUpdates || 0,
        newUsersThisWeek: recentUsers.length
      },
      recentUsers: recentUsers.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        preferences: user.preferences
      })),
      topTrackedGames: topTrackedGames.map(game => ({
        title: game._id,
        trackingCount: game.count,
        source: game.source,
        image: game.image
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin statistics' },
      { status: 500 }
    );
  }
}