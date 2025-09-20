import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { User, TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// GET: Get all users for admin management
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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';

    await connectDB();

    // Build search query
    const searchQuery = search 
      ? {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
          ]
        }
      : {};

    // Get users with tracked games count
    const users = await User.aggregate([
      { $match: searchQuery },
      {
        $lookup: {
          from: 'trackedgames',
          localField: '_id',
          foreignField: 'userId',
          as: 'trackedGames'
        }
      },
      {
        $addFields: {
          trackedGamesCount: { $size: '$trackedGames' },
          lastActivity: {
            $max: '$trackedGames.lastChecked'
          }
        }
      },
      {
        $project: {
          password: 0,
          trackedGames: 0
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]);

    // Get total count for pagination
    const totalUsers = await User.countDocuments(searchQuery);

    return NextResponse.json({
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
        hasNext: page * limit < totalUsers,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

// DELETE: Delete a user and their tracked games
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Delete user's tracked games first
    await TrackedGame.deleteMany({ userId });

    // Delete the user
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: `User ${deletedUser.name} and their tracked games have been deleted`,
      deletedUser: {
        id: deletedUser._id,
        name: deletedUser.name,
        email: deletedUser.email
      }
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}