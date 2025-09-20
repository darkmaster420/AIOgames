import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { User, TrackedGame } from '../../../lib/models';
import { getCurrentUser } from '../../../lib/auth';

// GET: Get sequel notifications and preferences
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

    // Get user preferences
    const userWithPrefs = await User.findById(user.id);
    const sequelPrefs = userWithPrefs?.preferences?.sequelDetection || {
      enabled: true,
      sensitivity: 'moderate',
      notifyImmediately: true
    };

    // Get all sequel notifications for the user
    const gamesWithSequels = await TrackedGame.find({
      userId: user.id,
      'sequelNotifications.0': { $exists: true },
      isActive: true
    }).select('title sequelNotifications');

    const sequelNotifications = gamesWithSequels.flatMap((game: {
      _id: string;
      title: string;
      sequelNotifications: Array<{
        _id: string;
        detectedTitle: string;
        gameId: string;
        gameLink: string;
        image: string;
        description: string;
        source: string;
        similarity: number;
        sequelType: string;
        dateFound: Date;
        isRead: boolean;
        isConfirmed: boolean;
        downloadLinks: Array<{
          service: string;
          url: string;
          type: string;
        }>;
      }>;
    }) => 
      game.sequelNotifications.map((sequel) => ({
        notificationId: sequel._id,
        originalGameId: game._id,
        originalTitle: game.title,
        sequel: {
          title: sequel.detectedTitle,
          gameId: sequel.gameId,
          link: sequel.gameLink,
          image: sequel.image,
          description: sequel.description,
          source: sequel.source,
          similarity: sequel.similarity,
          sequelType: sequel.sequelType,
          dateFound: sequel.dateFound,
          isRead: sequel.isRead,
          isConfirmed: sequel.isConfirmed,
          downloadLinks: sequel.downloadLinks || []
        }
      }))
    );

    // Sort by date found (newest first)
    sequelNotifications.sort((a: { sequel: { dateFound: Date } }, b: { sequel: { dateFound: Date } }) => 
      new Date(b.sequel.dateFound).getTime() - new Date(a.sequel.dateFound).getTime()
    );

    const unreadCount = sequelNotifications.filter((n: { sequel: { isRead: boolean } }) => !n.sequel.isRead).length;

    return NextResponse.json({
      preferences: sequelPrefs,
      notifications: sequelNotifications,
      totalNotifications: sequelNotifications.length,
      unreadCount
    });

  } catch (error) {
    console.error('Error fetching sequel notifications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sequel notifications' },
      { status: 500 }
    );
  }
}

// POST: Update sequel preferences
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { enabled, sensitivity, notifyImmediately } = await req.json();

    // Validate input
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    if (sensitivity && !['strict', 'moderate', 'loose'].includes(sensitivity)) {
      return NextResponse.json(
        { error: 'sensitivity must be strict, moderate, or loose' },
        { status: 400 }
      );
    }

    if (typeof notifyImmediately !== 'undefined' && typeof notifyImmediately !== 'boolean') {
      return NextResponse.json(
        { error: 'notifyImmediately must be a boolean' },
        { status: 400 }
      );
    }

    await connectDB();

    // Update user preferences
    const updateData: { [key: string]: unknown } = {
      'preferences.sequelDetection.enabled': enabled
    };

    if (sensitivity) {
      updateData['preferences.sequelDetection.sensitivity'] = sensitivity;
    }

    if (typeof notifyImmediately === 'boolean') {
      updateData['preferences.sequelDetection.notifyImmediately'] = notifyImmediately;
    }

    await User.findByIdAndUpdate(user.id, {
      $set: updateData
    });

    return NextResponse.json({
      message: 'Sequel preferences updated successfully',
      preferences: {
        enabled,
        sensitivity: sensitivity || 'moderate',
        notifyImmediately: notifyImmediately !== undefined ? notifyImmediately : true
      }
    });

  } catch (error) {
    console.error('Error updating sequel preferences:', error);
    return NextResponse.json(
      { error: 'Failed to update sequel preferences' },
      { status: 500 }
    );
  }
}

// PUT: Mark sequel notification as read/confirmed or track sequel
export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, notificationId, action } = await req.json();

    if (!gameId || !notificationId || !action) {
      return NextResponse.json(
        { error: 'gameId, notificationId, and action are required' },
        { status: 400 }
      );
    }

    if (!['mark_read', 'confirm', 'track_sequel', 'dismiss'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be mark_read, confirm, track_sequel, or dismiss' },
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

    const notification = game.sequelNotifications.find((n: { _id: { toString: () => string } }) => 
      n._id.toString() === notificationId
    );

    if (!notification) {
      return NextResponse.json(
        { error: 'Sequel notification not found' },
        { status: 404 }
      );
    }

    if (action === 'mark_read') {
      await TrackedGame.updateOne(
        { _id: gameId, 'sequelNotifications._id': notificationId },
        { $set: { 'sequelNotifications.$.isRead': true } }
      );
      
      return NextResponse.json({
        message: 'Sequel notification marked as read'
      });
    }

    if (action === 'confirm') {
      await TrackedGame.updateOne(
        { _id: gameId, 'sequelNotifications._id': notificationId },
        { $set: { 
          'sequelNotifications.$.isRead': true,
          'sequelNotifications.$.isConfirmed': true 
        } }
      );
      
      return NextResponse.json({
        message: 'Sequel notification confirmed'
      });
    }

    if (action === 'track_sequel') {
      // Add the sequel as a new tracked game
      const existingSequel = await TrackedGame.findOne({
        userId: user.id,
        gameId: notification.gameId
      });

      if (existingSequel) {
        return NextResponse.json(
          { error: 'Sequel is already being tracked' },
          { status: 400 }
        );
      }

      const newTrackedGame = new TrackedGame({
        userId: user.id,
        gameId: notification.gameId,
        title: notification.detectedTitle,
        source: notification.source,
        image: notification.image,
        description: notification.description,
        gameLink: notification.gameLink,
        originalTitle: notification.detectedTitle
      });

      await newTrackedGame.save();

      // Mark notification as confirmed
      await TrackedGame.updateOne(
        { _id: gameId, 'sequelNotifications._id': notificationId },
        { $set: { 
          'sequelNotifications.$.isRead': true,
          'sequelNotifications.$.isConfirmed': true 
        } }
      );

      return NextResponse.json({
        message: 'Sequel added to tracking',
        trackedGame: newTrackedGame
      });
    }

    if (action === 'dismiss') {
      await TrackedGame.updateOne(
        { _id: gameId },
        { $pull: { sequelNotifications: { _id: notificationId } } }
      );

      return NextResponse.json({
        message: 'Sequel notification dismissed'
      });
    }

  } catch (error) {
    console.error('Error processing sequel notification:', error);
    return NextResponse.json(
      { error: 'Failed to process sequel notification' },
      { status: 500 }
    );
  }
}