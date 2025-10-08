import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import updateScheduler from '../../../../lib/scheduler';

// PUT: Update check frequency for a tracked game
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, frequency } = await request.json();

    if (!gameId || !frequency) {
      return NextResponse.json(
        { error: 'Game ID and frequency are required' },
        { status: 400 }
      );
    }

    if (!['hourly', 'daily', 'weekly', 'manual'].includes(frequency)) {
      return NextResponse.json(
        { error: 'Invalid frequency. Must be hourly, daily, weekly, or manual' },
        { status: 400 }
      );
    }

    await connectDB();

    // Update the tracked game's frequency
    const updatedGame = await TrackedGame.findOneAndUpdate(
      { _id: gameId, userId: user.id },
      { checkFrequency: frequency },
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    // Update the user's schedule in the scheduler
    await updateScheduler.updateUserSchedule(user.id);

    console.log(`🔄 Updated frequency for "${updatedGame.title}" to ${frequency} for user ${user.id}`);

    return NextResponse.json({
      success: true,
      game: {
        id: updatedGame._id,
        title: updatedGame.title,
        checkFrequency: updatedGame.checkFrequency
      },
      message: `Update frequency changed to ${frequency}`
    });

  } catch (error) {
    console.error('Update frequency error:', error);
    return NextResponse.json(
      { error: 'Failed to update frequency' },
      { status: 500 }
    );
  }
}