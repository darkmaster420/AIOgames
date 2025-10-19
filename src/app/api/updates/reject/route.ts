import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// POST: Reject a pending update (Admin only)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is admin
    await connectDB();
    const userDoc = await User.findById(user.id);
    if (!userDoc || userDoc.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required to reject updates' },
        { status: 403 }
      );
    }

    const { gameId, updateIndex } = await request.json();

    if (!gameId || updateIndex === undefined) {
      return NextResponse.json(
        { error: 'Game ID and update index are required' },
        { status: 400 }
      );
    }

    // No need to call connectDB again - already called above for admin check

    // Find the game and get the pending update
    const game = await TrackedGame.findOne({
      _id: gameId,
      userId: user.id
    });

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    if (!game.pendingUpdates || updateIndex >= game.pendingUpdates.length) {
      return NextResponse.json(
        { error: 'Pending update not found' },
        { status: 404 }
      );
    }

    const pendingUpdate = game.pendingUpdates[updateIndex];

    // Remove the pending update
    await TrackedGame.findByIdAndUpdate(gameId, {
      $pull: { pendingUpdates: { _id: pendingUpdate._id } }
    });

    console.log(`❌ User ${user.id} rejected update for "${game.title}": ${pendingUpdate.newTitle}`);

    return NextResponse.json({
      success: true,
      message: 'Update rejected and removed',
      rejectedUpdate: {
        title: pendingUpdate.newTitle,
        version: pendingUpdate.detectedVersion,
        link: pendingUpdate.newLink
      }
    });

  } catch (error) {
    console.error('Error rejecting update:', error);
    return NextResponse.json(
      { error: 'Failed to reject update' },
      { status: 500 }
    );
  }
}