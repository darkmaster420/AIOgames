import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { TrackedGame } from '@/lib/models';
import connectDB from '@/lib/db';

/**
 * POST /api/games/mark-seen
 * Mark a game's new update as seen by the user
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { gameId } = await req.json();
    
    if (!gameId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Update the game to mark the new update as seen
    const updatedGame = await TrackedGame.findOneAndUpdate(
      { 
        _id: gameId, 
        userId: session.user.id,
        hasNewUpdate: true 
      },
      { 
        newUpdateSeen: true,
        hasNewUpdate: false
      },
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json(
        { error: 'Game not found or no new updates' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Update marked as seen' 
    });

  } catch (error) {
    console.error('Mark seen error:', error);
    return NextResponse.json(
      { error: 'Failed to mark update as seen' },
      { status: 500 }
    );
  }
}