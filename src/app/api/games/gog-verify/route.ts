/**
 * GOG Verification API Endpoint
 * Handles GOG game verification actions (add, remove)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import connectToDatabase from '@/lib/db';
import { TrackedGame } from '@/lib/models';
import logger from '@/utils/logger';

export const dynamic = 'force-dynamic';

// POST: Add/Update GOG verification
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, gogId, gogName, gogVersion, gogBuildId } = await request.json();

    if (!gameId || !gogId) {
      return NextResponse.json(
        { error: 'gameId and gogId are required' },
        { status: 400 }
      );
    }

    await connectToDatabase();

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

    // Update GOG verification
    game.gogVerified = true;
    game.gogProductId = gogId;
    game.gogName = gogName || null;
    game.gogVersion = gogVersion || null;
    game.gogBuildId = gogBuildId || null;
    game.gogLastChecked = new Date();

    await game.save();

    logger.info(`✅ GOG verified: ${game.title} -> ${gogName} (ID: ${gogId})`);

    return NextResponse.json({
      success: true,
      message: 'GOG verification added',
      game: {
        gogVerified: game.gogVerified,
        gogProductId: game.gogProductId,
        gogName: game.gogName,
        gogVersion: game.gogVersion,
        gogBuildId: game.gogBuildId
      }
    });

  } catch (error) {
    logger.error('❌ GOG verification error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to verify GOG game',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// DELETE: Remove GOG verification
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId } = await request.json();

    if (!gameId) {
      return NextResponse.json(
        { error: 'gameId is required' },
        { status: 400 }
      );
    }

    await connectToDatabase();

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

    // Remove GOG verification
    game.gogVerified = false;
    game.gogProductId = null;
    game.gogName = null;
    game.gogVersion = null;
    game.gogBuildId = null;
    game.gogLastChecked = undefined;

    await game.save();

    logger.info(`🗑️ GOG verification removed: ${game.title}`);

    return NextResponse.json({
      success: true,
      message: 'GOG verification removed'
    });

  } catch (error) {
    logger.error('❌ GOG verification removal error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to remove GOG verification',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
