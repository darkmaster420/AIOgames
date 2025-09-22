import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import connectDB from '@/lib/db';
import { TrackedGame } from '@/lib/models';
import { searchSteamGames } from '@/utils/steamApi';

/**
 * POST /api/games/steam-verify
 * Search Steam API for game matches
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { gameId, query } = await request.json();

    if (!gameId || !query) {
      return NextResponse.json({ error: 'Game ID and search query are required' }, { status: 400 });
    }

    await connectDB();

    // Get the tracked game
    const trackedGame = await TrackedGame.findOne({ 
      _id: gameId,
      userId: user.id 
    });

    if (!trackedGame) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Search Steam API
    const searchResults = await searchSteamGames(query, 10);

    return NextResponse.json({
      success: true,
      results: searchResults.results,
      query: searchResults.query,
      total: searchResults.total
    });

  } catch (error) {
    console.error('Steam verification search error:', error);
    return NextResponse.json({ 
      error: 'Failed to search Steam API',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * PATCH /api/games/steam-verify
 * Link a tracked game to a Steam app
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { gameId, steamAppId, steamName } = await request.json();

    if (!gameId || (!steamAppId && steamName !== null)) {
      return NextResponse.json({ error: 'Game ID and Steam app ID are required' }, { status: 400 });
    }

    await connectDB();

    // Update the tracked game with Steam verification
    const updateData = {
      steamVerified: true,
      steamAppId: steamAppId || null,
      steamName: steamName || null
    };

    const updatedGame = await TrackedGame.findOneAndUpdate(
      { _id: gameId, userId: user.id },
      updateData,
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      game: updatedGame
    });

  } catch (error) {
    console.error('Steam verification link error:', error);
    return NextResponse.json({ 
      error: 'Failed to link Steam game',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * DELETE /api/games/steam-verify
 * Remove Steam verification from a tracked game
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const gameId = url.searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json({ error: 'Game ID is required' }, { status: 400 });
    }

    await connectDB();

    // Remove Steam verification data
    const updatedGame = await TrackedGame.findOneAndUpdate(
      { _id: gameId, userId: user.id },
      {
        $unset: {
          steamAppId: 1,
          steamName: 1
        },
        steamVerified: false
      },
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      game: updatedGame
    });

  } catch (error) {
    console.error('Steam verification removal error:', error);
    return NextResponse.json({ 
      error: 'Failed to remove Steam verification',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}