import webpush from 'web-push';
import { User } from '../lib/models';
import { 
  sendTelegramMessage, 
  getTelegramConfig, 
  formatGameUpdateMessage, 
  formatSequelNotificationMessage 
} from './telegram';

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
  methods: {
    webpush: { sent: number; failed: number; errors: string[] };
    telegram: { sent: number; failed: number; errors: string[] };
  };
}

/**
 * Send update notifications to a specific user via their preferred method(s)
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
    errors: [],
    methods: {
      webpush: { sent: 0, failed: 0, errors: [] },
      telegram: { sent: 0, failed: 0, errors: [] }
    }
  };

  try {
    // Get user data
    const user = await User.findById(userId);
    if (!user) {
      result.errors.push('User not found');
      return result;
    }

    // Check if user wants immediate notifications
    if (!user.preferences?.notifications?.notifyImmediately) {
      result.errors.push('User has disabled immediate notifications');
      return result;
    }

    const notificationPrefs = user.preferences.notifications;
    const provider = notificationPrefs?.provider || 'webpush';
    
    // Send Telegram notification if enabled and configured
    if ((provider === 'telegram' || notificationPrefs?.telegramEnabled) && notificationPrefs?.telegramEnabled) {
      const telegramConfig = getTelegramConfig(user);
      if (telegramConfig) {
        try {
          const isSequel = updateData.updateType === 'sequel';
          const message = isSequel 
            ? formatSequelNotificationMessage({
                originalTitle: updateData.gameTitle,
                detectedTitle: updateData.gameTitle,
                sequelType: 'sequel',
                gameLink: updateData.gameLink || '/tracking',
                source: 'Game Tracker',
                similarity: 1.0
              })
            : formatGameUpdateMessage({
                title: updateData.gameTitle,
                version: updateData.version,
                gameLink: updateData.gameLink || '/tracking',
                source: 'Game Tracker',
                changeType: 'update'
              });

          const telegramResult = await sendTelegramMessage(telegramConfig, message);
          
          if (telegramResult.success) {
            result.methods.telegram.sent++;
            result.sentCount++;
            console.log(`✅ Telegram notification sent to ${user.email} for ${updateData.gameTitle}`);
          } else {
            result.methods.telegram.failed++;
            result.failedCount++;
            result.methods.telegram.errors.push(telegramResult.error || 'Unknown Telegram error');
            console.error(`❌ Telegram notification failed for ${user.email}:`, telegramResult.error);
          }
        } catch (error) {
          result.methods.telegram.failed++;
          result.failedCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.methods.telegram.errors.push(`Telegram error: ${errorMessage}`);
          console.error(`❌ Telegram notification error for ${user.email}:`, error);
        }
      } else {
        result.methods.telegram.errors.push('Telegram enabled but not properly configured');
      }
    }

    // Send Web Push notification if enabled or if primary method
    if ((provider === 'webpush' || notificationPrefs?.webpushEnabled) && VAPID_PUBLIC && VAPID_PRIVATE) {
      if (user.pushSubscriptions && user.pushSubscriptions.length > 0) {
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
            result.methods.webpush.sent++;
            result.sentCount++;
            console.log(`✅ Web Push notification sent to ${user.email} for ${updateData.gameTitle}`);
          } catch (error) {
            result.methods.webpush.failed++;
            result.failedCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.methods.webpush.errors.push(`Web Push error: ${errorMessage}`);
            console.error(`❌ Web Push notification failed for ${user.email}:`, errorMessage);
          }
        }
      } else {
        result.methods.webpush.errors.push('No push subscriptions found');
      }
    } else if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      result.methods.webpush.errors.push('VAPID keys not configured');
    }

    // Consolidate errors
    result.errors = [
      ...result.methods.webpush.errors,
      ...result.methods.telegram.errors
    ];

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
        errors: [error instanceof Error ? error.message : String(error)],
        methods: {
          webpush: { sent: 0, failed: 0, errors: [] },
          telegram: { sent: 0, failed: 1, errors: [error instanceof Error ? error.message : String(error)] }
        }
      });
    }
  }

  // Log summary
  const totalSent = results.reduce((sum, r) => sum + r.sentCount, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failedCount, 0);
  const successfulUsers = results.filter(r => r.success).length;
  const telegramSent = results.reduce((sum, r) => sum + r.methods.telegram.sent, 0);
  const webpushSent = results.reduce((sum, r) => sum + r.methods.webpush.sent, 0);
  
  console.log(`📢 Notification Summary for "${updateData.gameTitle}":`);
  console.log(`   Users notified: ${successfulUsers}/${userIds.length}`);
  console.log(`   Total notifications sent: ${totalSent}`);
  console.log(`   ├── Telegram: ${telegramSent}`);
  console.log(`   ├── Web Push: ${webpushSent}`);
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