import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';

// POST: Approve a pending update (Admin only)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is admin or owner
    await connectDB();
    const userDoc = await User.findById(user.id);
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'owner')) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required to approve updates' },
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

    // Create version string
    let versionString = '';
    if (pendingUpdate.detectedVersion) versionString += `v${pendingUpdate.detectedVersion}`;
    if (pendingUpdate.build) versionString += (versionString ? ' ' : '') + `Build ${pendingUpdate.build}`;
    if (pendingUpdate.releaseType) versionString += (versionString ? ' ' : '') + pendingUpdate.releaseType;
    if (pendingUpdate.updateType) versionString += (versionString ? ' ' : '') + `(${pendingUpdate.updateType})`;
    if (!versionString) versionString = 'New Version';

    // Create the approved update for updateHistory
    const approvedUpdate = {
      version: versionString,
      build: pendingUpdate.build || '',
      releaseType: pendingUpdate.releaseType || '',
      updateType: pendingUpdate.updateType || '',
      changeType: 'user_approved',
      significance: 2, // User-approved updates are considered significant
      dateFound: pendingUpdate.dateFound,
      gameLink: pendingUpdate.newLink,
      previousVersion: game.lastKnownVersion || 'Unknown',
      downloadLinks: pendingUpdate.downloadLinks || [],
      steamEnhanced: pendingUpdate.steamEnhanced || false,
      steamAppId: pendingUpdate.steamAppId,
      userApproved: true,
      approvedAt: new Date(),
      source: pendingUpdate.source || 'Game Tracker'
    };

    // Complete replace the game record with the new update info and update all version-related fields
    await TrackedGame.findByIdAndUpdate(gameId, {
      $pull: { pendingUpdates: { _id: pendingUpdate._id } },
      lastKnownVersion: versionString,
      currentVersionNumber: versionString,
      versionNumberVerified: true,
      versionNumberSource: 'user_approved',
      versionNumberLastUpdated: new Date(),
      lastVersionDate: pendingUpdate.dateFound,
      dateAdded: new Date(), // Move game to top of list when update is approved
      title: pendingUpdate.newTitle,
      originalTitle: pendingUpdate.newTitle, // Update original title to match new title
      gameLink: pendingUpdate.newLink,
      ...(pendingUpdate.newImage && { image: pendingUpdate.newImage }),
      $push: {
        updateHistory: {
          $each: [{
            ...approvedUpdate,
            isLatest: true
          }],
          $position: 0
        }
      },
      // Mark this as the latest approved update
      latestApprovedUpdate: {
        version: versionString,
        dateFound: pendingUpdate.dateFound,
        gameLink: pendingUpdate.newLink,
        downloadLinks: pendingUpdate.downloadLinks || []
      },
      // Set new update indicator
      hasNewUpdate: true,
      newUpdateSeen: false
    });

    // Notify all users tracking this game
    try {
      const trackedGames = await TrackedGame.find({ gameId: game.gameId, isActive: true });
      const userIds = trackedGames.map(g => g.userId.toString());
      
      // Create notification data for approved update
      const notificationData = createUpdateNotificationData({
        gameTitle: pendingUpdate.newTitle,
        version: versionString,
        previousVersion: game.lastKnownVersion,
        gameLink: pendingUpdate.newLink || game.gameLink,
        imageUrl: pendingUpdate.newImage || game.image,
        downloadLinks: pendingUpdate.downloadLinks || [],
        updateType: 'update',
        isPending: false,
        source: pendingUpdate.source || 'Game Tracker'
      });

      // Send notification to all users tracking this game
      for (const userId of userIds) {
        try {
          await sendUpdateNotification(userId, notificationData);
        } catch (notifyError) {
          console.error(`Failed to send notification to user ${userId}:`, notifyError);
        }
      }
    } catch (notifyError) {
      console.error('Failed to send notifications for approved update:', notifyError);
    }

    console.log(`✅ User ${user.id} approved update for "${game.title}": ${versionString}`);

    return NextResponse.json({
      success: true,
      message: 'Update approved and applied',
      approvedUpdate: {
        version: versionString,
        title: pendingUpdate.newTitle,
        link: pendingUpdate.newLink
      }
    });

  } catch (error) {
    console.error('Error approving update:', error);
    return NextResponse.json(
      { error: 'Failed to approve update' },
      { status: 500 }
    );
  }
}