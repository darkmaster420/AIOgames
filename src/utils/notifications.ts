import webpush from 'web-push';
import { User } from '../lib/models';

// Configure VAPID keys
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

interface UpdateNotificationData {
  gameTitle: string;
  version?: string;
  updateType: 'update' | 'sequel';
  gameLink?: string;
  imageUrl?: string;
}

interface NotificationResult {
  userId: string;
  success: boolean;
  sentCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Send update notifications to a specific user
 */
export async function sendUpdateNotification(
  userId: string, 
  updateData: UpdateNotificationData
): Promise<NotificationResult> {
  const result: NotificationResult = {
    userId,
    success: false,
    sentCount: 0,
    failedCount: 0,
    errors: []
  };

  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      result.errors.push('VAPID keys not configured');
      return result;
    }

    // Get user's push subscriptions
    const user = await User.findById(userId);
    if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
      result.errors.push('No push subscriptions found for user');
      return result;
    }

    // Check if user wants immediate notifications
    if (!user.preferences?.notifications?.notifyImmediately) {
      result.errors.push('User has disabled immediate notifications');
      return result;
    }

    // Create notification payload
    const isSequel = updateData.updateType === 'sequel';
    const title = isSequel 
      ? `🎮 New Sequel Found!`
      : `🔄 Game Update Available!`;
    
    const body = isSequel
      ? `A sequel to "${updateData.gameTitle}" has been detected!`
      : `"${updateData.gameTitle}" has been updated${updateData.version ? ` to ${updateData.version}` : ''}!`;

    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      image: updateData.imageUrl,
      data: {
        gameTitle: updateData.gameTitle,
        updateType: updateData.updateType,
        version: updateData.version,
        gameLink: updateData.gameLink,
        url: updateData.gameLink || '/tracking'
      },
      actions: updateData.gameLink ? [
        {
          action: 'view',
          title: 'View Game'
        }
      ] : undefined,
      requireInteraction: true,
      tag: `game-update-${updateData.gameTitle.replace(/\s+/g, '-').toLowerCase()}`
    });

    // Send to all user's subscriptions
    for (const subscription of user.pushSubscriptions) {
      try {
        await webpush.sendNotification(subscription, payload);
        result.sentCount++;
        console.log(`✅ Update notification sent to ${user.email} for ${updateData.gameTitle}`);
      } catch (error) {
        result.failedCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to send to ${subscription.endpoint}: ${errorMessage}`);
        console.error(`❌ Failed to send notification to ${user.email}:`, errorMessage);
      }
    }

    result.success = result.sentCount > 0;
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(`Notification error: ${errorMessage}`);
    console.error('sendUpdateNotification error:', error);
    return result;
  }
}

/**
 * Send update notifications to multiple users
 */
export async function sendUpdateNotificationToMultipleUsers(
  userIds: string[],
  updateData: UpdateNotificationData
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];
  
  for (const userId of userIds) {
    try {
      const result = await sendUpdateNotification(userId, updateData);
      results.push(result);
    } catch (error) {
      results.push({
        userId,
        success: false,
        sentCount: 0,
        failedCount: 1,
        errors: [error instanceof Error ? error.message : String(error)]
      });
    }
  }

  // Log summary
  const totalSent = results.reduce((sum, r) => sum + r.sentCount, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failedCount, 0);
  const successfulUsers = results.filter(r => r.success).length;
  
  console.log(`📢 Notification Summary for "${updateData.gameTitle}":`);
  console.log(`   Users notified: ${successfulUsers}/${userIds.length}`);
  console.log(`   Notifications sent: ${totalSent}`);
  console.log(`   Failed attempts: ${totalFailed}`);

  return results;
}

/**
 * Helper to extract notification data from update info
 */
export function createUpdateNotificationData(
  gameTitle: string,
  updateInfo: {
    version?: string;
    gameLink?: string;
    link?: string;
    image?: string;
    newImage?: string;
  },
  updateType: 'update' | 'sequel' = 'update'
): UpdateNotificationData {
  return {
    gameTitle,
    version: updateInfo.version,
    updateType,
    gameLink: updateInfo.gameLink || updateInfo.link,
    imageUrl: updateInfo.image || updateInfo.newImage
  };
}