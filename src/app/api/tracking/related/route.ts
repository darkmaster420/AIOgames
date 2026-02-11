import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { calculateGamePriority } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';

/**
 * POST /api/tracking/related
 * Confirm a pending related game (add as new tracked game) or dismiss it
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { trackedGameId, pendingGameId, action } = await request.json();

    if (!trackedGameId || !pendingGameId || !action) {
      return NextResponse.json(
        { error: 'trackedGameId, pendingGameId, and action are required' },
        { status: 400 }
      );
    }

    if (!['track_same', 'track_separate', 'dismiss'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "track_same", "track_separate", or "dismiss"' },
        { status: 400 }
      );
    }

    await connectDB();

    // Get the tracked game with pending related games
    const trackedGame = await TrackedGame.findOne({
      _id: trackedGameId,
      userId: user.id,
      isActive: true
    });

    if (!trackedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    // Find the pending related game
    const pendingGame = trackedGame.pendingRelatedGames?.find(
      (p: { gameId: string }) => p.gameId === pendingGameId
    );

    if (!pendingGame) {
      return NextResponse.json(
        { error: 'Pending related game not found' },
        { status: 404 }
      );
    }

    if (action === 'dismiss') {
      // Mark as dismissed
      await TrackedGame.updateOne(
        { 
          _id: trackedGameId,
          'pendingRelatedGames.gameId': pendingGameId 
        },
        { 
          $set: { 'pendingRelatedGames.$.dismissed': true } 
        }
      );

      logger.info(`User ${user.id} dismissed pending game "${pendingGame.title}" for "${trackedGame.title}"`);

      return NextResponse.json({
        message: 'Pending game dismissed',
        success: true
      });
    } else if (action === 'track_same') {
      // Update the existing tracked game with the new version
      const { User } = await import('../../../../lib/models');
      const fullUser = await User.findById(user.id);
      const preferRepacks = fullUser?.preferences?.releaseGroups?.preferRepacks || false;
      
      const priority = calculateGamePriority(pendingGame.originalTitle || pendingGame.title, preferRepacks);

      trackedGame.gameId = pendingGame.gameId;
      trackedGame.originalTitle = pendingGame.originalTitle;
      trackedGame.gameLink = pendingGame.link;
      trackedGame.image = pendingGame.image;
      trackedGame.description = pendingGame.description;
      trackedGame.source = pendingGame.source;
      trackedGame.lastKnownVersion = pendingGame.version || trackedGame.lastKnownVersion;
      trackedGame.priority = priority;
      
      await trackedGame.save();

      // Mark as dismissed in the pending list (it's been applied)
      await TrackedGame.updateOne(
        { 
          _id: trackedGameId,
          'pendingRelatedGames.gameId': pendingGameId 
        },
        { 
          $set: { 'pendingRelatedGames.$.dismissed': true } 
        }
      );

      logger.info(`User ${user.id} updated tracked game "${trackedGame.title}" with pending game "${pendingGame.title}"`);

      return NextResponse.json({
        message: 'Tracked game updated',
        game: trackedGame,
        success: true
      }, { status: 200 });
    } else {
      // track_separate - Add as new tracked game
      // Get user preferences for priority calculation
      const { User } = await import('../../../../lib/models');
      const fullUser = await User.findById(user.id);
      const preferRepacks = fullUser?.preferences?.releaseGroups?.preferRepacks || false;
      
      const priority = calculateGamePriority(pendingGame.originalTitle || pendingGame.title, preferRepacks);

      const newTrackedGame = new TrackedGame({
        userId: user.id,
        gameId: pendingGame.gameId,
        title: pendingGame.title,
        originalTitle: pendingGame.originalTitle,
        source: pendingGame.source,
        image: pendingGame.image,
        description: pendingGame.description,
        gameLink: pendingGame.link,
        priority: priority,
        lastKnownVersion: pendingGame.version || '',
        sequelSource: {
          originalGameId: trackedGame._id,
          originalGameTitle: trackedGame.title,
          detectionMethod: 'manual',
          similarity: pendingGame.similarity,
          sequelType: pendingGame.relationshipType?.replace('potential_', '')
        }
      });

      await newTrackedGame.save();

      // Mark as dismissed in the pending list (it's now tracked)
      await TrackedGame.updateOne(
        { 
          _id: trackedGameId,
          'pendingRelatedGames.gameId': pendingGameId 
        },
        { 
          $set: { 'pendingRelatedGames.$.dismissed': true } 
        }
      );

      logger.info(`User ${user.id} confirmed and tracked pending game "${pendingGame.title}" as ${pendingGame.relationshipType} of "${trackedGame.title}"`);

      return NextResponse.json({
        message: 'Game added to tracking',
        game: newTrackedGame,
        success: true
      }, { status: 201 });
    }

  } catch (error) {
    logger.error('Error handling pending related game:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tracking/related
 * Get all pending related games for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get all tracked games with non-dismissed pending related games
    const trackedGames = await TrackedGame.find({
      userId: user.id,
      isActive: true,
      pendingRelatedGames: { $exists: true, $ne: [] }
    }).select('gameId title originalTitle pendingRelatedGames');

    // Filter out dismissed pending games
    const pendingRelations = trackedGames
      .map(game => ({
        trackedGameId: game._id,
        trackedGameTitle: game.title,
        pendingGames: game.pendingRelatedGames?.filter((p: { dismissed: boolean }) => !p.dismissed) || []
      }))
      .filter(item => item.pendingGames.length > 0);

    return NextResponse.json({
      relations: pendingRelations,
      totalPending: pendingRelations.reduce((sum, item) => sum + item.pendingGames.length, 0)
    });

  } catch (error) {
    logger.error('Error fetching pending related games:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
