import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// GET: List all pending updates for the current user
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

    const gamesWithPendingUpdates = await TrackedGame.find({
      userId: user.id,
      'pendingUpdates.0': { $exists: true },
      isActive: true
    }).select('title image pendingUpdates');

    return NextResponse.json({
      success: true,
      games: gamesWithPendingUpdates
    });

  } catch (error) {
    console.error('Error fetching pending updates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pending updates' },
      { status: 500 }
    );
  }
}

// POST: Confirm or reject a pending update
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, updateId, action } = await req.json();

    if (!gameId || !updateId || !['confirm', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid request. Need gameId, updateId, and action (confirm/reject)' },
        { status: 400 }
      );
    }

    await connectDB();

    const game = await TrackedGame.findOne({
      _id: gameId,
      userId: user.id
    });

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found or access denied' },
        { status: 404 }
      );
    }

    // Find the specific pending update
    const pendingUpdate = game.pendingUpdates.find((update: {
      _id: { toString: () => string };
      newTitle: string;
      newLink: string;
      detectedVersion: string;
      build: string;
      releaseType: string;
      updateType: string;
      reason: string;
      dateFound: Date;
      downloadLinks: Array<{
        service: string;
        url: string;
        type: string;
      }>;
    }) => 
      update._id.toString() === updateId
    );

    if (!pendingUpdate) {
      return NextResponse.json(
        { error: 'Pending update not found' },
        { status: 404 }
      );
    }

    if (action === 'confirm') {
      // Move to update history
      const versionString = [
        pendingUpdate.detectedVersion ? `v${pendingUpdate.detectedVersion}` : '',
        pendingUpdate.build ? `Build ${pendingUpdate.build}` : '',
        pendingUpdate.releaseType || '',
        pendingUpdate.updateType ? `(${pendingUpdate.updateType})` : ''
      ].filter(Boolean).join(' ') || 'User Confirmed Update';

      const confirmedUpdate = {
        version: versionString,
        build: pendingUpdate.build || '',
        releaseType: pendingUpdate.releaseType || '',
        updateType: pendingUpdate.updateType || 'User Confirmed',
        changeType: 'user_confirmed',
        significance: 1,
        dateFound: pendingUpdate.dateFound,
        gameLink: pendingUpdate.newLink,
        previousVersion: game.lastKnownVersion || 'Unknown',
        confirmedByUser: true,
        originalReason: pendingUpdate.reason,
        downloadLinks: pendingUpdate.downloadLinks || []
      };

      await TrackedGame.findByIdAndUpdate(gameId, {
        $push: { updateHistory: confirmedUpdate },
        $pull: { pendingUpdates: { _id: updateId } },
        lastKnownVersion: versionString,
        lastVersionDate: new Date(),
        gameLink: pendingUpdate.newLink,
        title: pendingUpdate.newTitle
      });

      // Notify all users tracking this game
      try {
        const { sendUpdateNotificationToMultipleUsers, createUpdateNotificationData } = await import('../../../../utils/notifications');
        const trackedGames = await TrackedGame.find({ gameId: game.gameId, isActive: true });
        const userIds = trackedGames.map(g => g.userId.toString());
        const notificationData = createUpdateNotificationData({
          gameTitle: pendingUpdate.newTitle,
          version: versionString,
          gameLink: pendingUpdate.newLink,
          imageUrl: pendingUpdate.newImage,
          updateType: 'update'
        });
        console.log('[NOTIFY][PENDING] userIds:', userIds, 'notificationData:', notificationData);
        await sendUpdateNotificationToMultipleUsers(userIds, notificationData);
      } catch (notifyError) {
        console.error('Failed to send notifications for confirmed update:', notifyError);
      }

      return NextResponse.json({
        message: 'Update confirmed and added to history',
        confirmedUpdate: {
          title: pendingUpdate.newTitle,
          version: versionString,
          link: pendingUpdate.newLink
        }
      });

    } else if (action === 'reject') {
      // Just remove from pending updates
      await TrackedGame.findByIdAndUpdate(gameId, {
        $pull: { pendingUpdates: { _id: updateId } }
      });

      return NextResponse.json({
        message: 'Update rejected and removed from pending list'
      });
    }

  } catch (error) {
    console.error('Error processing pending update:', error);
    return NextResponse.json(
      { error: 'Failed to process pending update' },
      { status: 500 }
    );
  }
}