import { NextResponse } from 'next/server';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';

export async function POST(request: Request) {
  try {
    const { userId, gameTitle, version } = await request.json();

    if (!userId || !gameTitle) {
      return NextResponse.json(
        { error: 'userId and gameTitle are required' },
        { status: 400 }
      );
    }

    // Create test notification data
    const notificationData = createUpdateNotificationData({
      gameTitle,
      version: version || 'Test Version',
      gameLink: 'https://example.com/test-game',
      imageUrl: 'https://example.com/test-image.jpg',
      updateType: 'update'
    });

    // Send the notification
    const result = await sendUpdateNotification(userId, notificationData);

    return NextResponse.json({
      success: result.success,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      errors: result.errors,
      message: result.success 
        ? `Notification sent successfully to ${result.sentCount} subscription(s)`
        : 'Failed to send notification'
    });

  } catch (error) {
    console.error('Test notification error:', error);
    return NextResponse.json(
      { error: 'Failed to send test notification', details: error },
      { status: 500 }
    );
  }
}