import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { sendTelegramMessage, sendTelegramPhoto, getTelegramConfig, formatGameUpdateMessage } from '../../../../utils/telegram';

// POST: Approve a pending update
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
      title: pendingUpdate.newTitle,
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
            // Create notification data with proper change type
      const notificationData = {
        title: pendingUpdate.newTitle, // Use the new updated title
        version: versionString, // Using the version string from the approved update
        previousVersion: game.lastKnownVersion,
        gameLink: pendingUpdate.newLink || game.gameLink,
        source: pendingUpdate.source || 'Game Tracker',
        changeType: 'user_approved', // Mark this as an approved update
        downloadLinks: pendingUpdate.downloadLinks || [],
        imageUrl: pendingUpdate.newImage || game.image // Include the image URL for Telegram photos
      };

      // Format the message using the game update formatter
      const message = formatGameUpdateMessage(notificationData);
      // Send the notification to all users
      for (const userId of userIds) {
        const user = await User.findById(userId);
        if (!user) continue; // Skip if user not found
        const telegramConfig = getTelegramConfig(user);
        if (telegramConfig) { // Only send if we have valid telegram config
          // Check if message includes photo
          if ('photo' in message) {
            await sendTelegramPhoto(telegramConfig, message);
          } else {
            await sendTelegramMessage(telegramConfig, message);
          }
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