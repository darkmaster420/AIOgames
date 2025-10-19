import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// PUT: Toggle notifications for a tracked game
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, enabled } = await request.json();

    if (!gameId || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Game ID and enabled status are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Update the tracked game's notification setting
    const updatedGame = await TrackedGame.findOneAndUpdate(
      { _id: gameId, userId: user.id },
      { notificationsEnabled: enabled },
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    console.log(`🔔 Updated notifications for "${updatedGame.title}" to ${enabled ? 'enabled' : 'disabled'} for user ${user.id}`);

    return NextResponse.json({
      success: true,
      game: {
        id: updatedGame._id,
        title: updatedGame.title,
        notificationsEnabled: updatedGame.notificationsEnabled
      },
      message: `Notifications ${enabled ? 'enabled' : 'disabled'} for this game`
    });

  } catch (error) {
    console.error('Update notification settings error:', error);
    return NextResponse.json(
      { error: 'Failed to update notification settings' },
      { status: 500 }
    );
  }
}
