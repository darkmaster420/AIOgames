import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// POST: Reject a pending update
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, updateIndex } = await request.json();

    if (!gameId || updateIndex === undefined) {
      return NextResponse.json(
        { error: 'Game ID and update index are required' },
        { status: 400 }
      );
    }

    await connectDB();

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