import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { TrackedGame } from '../../../lib/models';
import { getCurrentUser } from '../../../lib/auth';
import { cleanGameTitle, decodeHtmlEntities } from '../../../utils/steamApi';

// GET - Fetch all tracked games for the current user
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
    
    const trackedGames = await TrackedGame.find({ 
      userId: user.id,
      isActive: true 
    }).sort({ dateAdded: -1 });
    
    return NextResponse.json({
      games: trackedGames
    });

  } catch (error) {
    console.error('Get tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tracked games' },
      { status: 500 }
    );
  }
}

// POST - Add a new game to tracking
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, title, source, image, description, gameLink } = await request.json();

    if (!gameId || !title || !source || !gameLink) {
      return NextResponse.json(
        { error: 'gameId, title, source, and gameLink are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if game is already tracked by this user
    const existingGame = await TrackedGame.findOne({ 
      userId: user.id,
      gameId 
    });

    if (existingGame) {
      if (!existingGame.isActive) {
        // Reactivate the game
        existingGame.isActive = true;
        existingGame.dateAdded = new Date();
        await existingGame.save();
        
        return NextResponse.json({
          message: 'Game reactivated for tracking',
          game: existingGame
        });
      } else {
        return NextResponse.json(
          { error: 'Game is already being tracked' },
          { status: 400 }
        );
      }
    }

    // Create new tracked game
    const trackedGame = new TrackedGame({
      userId: user.id,
      gameId,
      title,
      source,
      image,
      description: decodeHtmlEntities(description || ''),
      gameLink,
      originalTitle: title,
      cleanedTitle: cleanGameTitle(title)
    });

    await trackedGame.save();

    return NextResponse.json({
      message: 'Game added to tracking',
      game: trackedGame
    }, { status: 201 });

  } catch (error) {
    console.error('Add tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to add game to tracking' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a game from tracking
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
    const gameId = searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json(
        { error: 'gameId is required' },
        { status: 400 }
      );
    }

    await connectDB();

    const result = await TrackedGame.findOneAndUpdate(
      { userId: user.id, gameId },
      { isActive: false },
      { new: true }
    );

    if (!result) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Game removed from tracking',
      game: result
    });

  } catch (error) {
    console.error('Remove tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to remove game from tracking' },
      { status: 500 }
    );
  }
}