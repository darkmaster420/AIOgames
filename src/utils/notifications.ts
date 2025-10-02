import webpush from 'web-push';
import { User } from '../lib/models';
import { 
  sendTelegramMessage, 
  sendTelegramPhoto,
  getTelegramConfig, 
  formatGameUpdateMessage, 
  formatSequelNotificationMessage,
  TelegramMessage,
  TelegramPhotoMessage
} from './telegram';
import { configureWebPush, getVapidKeys } from './vapidKeys';

// Configure VAPID keys on module load
configureWebPush();

export interface UpdateNotificationData {
  gameTitle: string;
  version?: string;
  updateType: 'update' | 'sequel';
  gameLink?: string;
  imageUrl?: string;
  downloadLinks?: Array<{ service: string; url: string; type?: string }>;
  previousVersion?: string;
}

/**
 * Helper function to create properly formatted notification data
 */
export function createUpdateNotificationData(params: {
  gameTitle: string;
  version?: string;
  updateType: 'update' | 'sequel';
  gameLink?: string;
  imageUrl?: string;
  downloadLinks?: Array<{ service: string; url: string; type?: string }>;
  previousVersion?: string;
}): UpdateNotificationData {
  return {
    gameTitle: params.gameTitle,
    version: params.version,
    updateType: params.updateType,
    gameLink: params.gameLink,
    imageUrl: params.imageUrl,
    downloadLinks: params.downloadLinks,
    previousVersion: params.previousVersion,
  };
}

interface NotificationResult {
  userId: string;
  success: boolean;
  sentCount: number;
  failedCount: number;
  errors: string[];
  methods: {
    webpush: { sent: number; failed: number, errors: string[] };
    telegram: { sent: number; failed: number, errors: string[] };
  };
}

/**
 * Send update notifications to a specific user via their preferred method(s)
 */
export async function sendUpdateNotification(
  userId: string, 
  updateData: UpdateNotificationData
): Promise<NotificationResult> {
  console.log(`[Notifications] Starting notification process for user ${userId}`, {
    gameTitle: updateData.gameTitle,
    updateType: updateData.updateType,
    version: updateData.version
  });

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
      console.error(`[Notifications] User not found: ${userId}`);
      result.errors.push('User not found');
      return result;
    }

    // Check user preferences - check if user wants immediate notifications
    if (!user.preferences?.notifications?.notifyImmediately) {
      console.log(`[Notifications] User ${userId} has disabled immediate notifications`);
      return result;
    }

    const notificationPrefs = user.preferences?.notifications;
    const provider = notificationPrefs?.provider || 'webpush';
    
    
    // Processing notifications for user    // Send Telegram notification if enabled and configured
    if ((provider === 'telegram' || notificationPrefs?.telegramEnabled) && notificationPrefs?.telegramEnabled) {
      // Telegram conditions met, getting config
      const telegramConfig = getTelegramConfig(user);
      if (telegramConfig) {
        // Got valid Telegram config
        try {
          console.log(`[Notifications] Sending Telegram notification for ${updateData.gameTitle} to user ${userId}`);
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
                previousVersion: updateData.previousVersion,
                gameLink: updateData.gameLink || '/tracking',
                source: 'Game Tracker',
                changeType: 'automatic', // Auto-approved updates
                downloadLinks: updateData.downloadLinks,
                imageUrl: updateData.imageUrl
              });
          
          // Check if message includes photo
          const telegramResult = 'photo' in message 
            ? await sendTelegramPhoto(telegramConfig, message as TelegramPhotoMessage)
            : await sendTelegramMessage(telegramConfig, message as TelegramMessage);
          
          if (telegramResult.success) {
            console.log(`[Notifications] Telegram message sent successfully to user ${userId}`);
            result.methods.telegram.sent++;
            result.sentCount++;
          } else {
            console.error(`[Notifications] Telegram failed for user ${userId}:`, telegramResult.error);
            result.methods.telegram.failed++;
            result.failedCount++;
            result.methods.telegram.errors.push(telegramResult.error || 'Unknown Telegram error');
          }
        } catch (error) {
          result.methods.telegram.failed++;
          result.failedCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.methods.telegram.errors.push(`Telegram error: ${errorMessage}`);
          console.error('❌ Telegram notification error:', error);
        }
      } else {
        console.log(`[Notifications] Telegram config missing for user ${userId} - enabled: ${notificationPrefs?.telegramEnabled}, botToken: ${!!notificationPrefs?.telegramBotToken}, chatId: ${!!notificationPrefs?.telegramChatId}`);
        result.methods.telegram.errors.push('Telegram enabled but not properly configured');
      }
    }

    // Send Web Push notification if enabled or if primary method
    if (provider === 'webpush' || notificationPrefs?.webpushEnabled) {
      try {
        getVapidKeys(); // Ensure VAPID keys are available
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
              title: 'View Update'
            }
          ] : undefined
        });

        // Send to all subscribed endpoints
        for (const sub of user.pushSubscriptions) {
          try {
            await webpush.sendNotification({
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.keys.p256dh,
                auth: sub.keys.auth
              }
            }, payload);
            result.methods.webpush.sent++;
            result.sentCount++;
          } catch (error) {
            result.methods.webpush.failed++;
            result.failedCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.methods.webpush.errors.push(`Push error: ${errorMessage}`);
          }
        }
      }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.methods.webpush.errors.push(`Web Push setup error: ${errorMessage}`);
        console.error('Web Push setup error:', error);
      }
    }

    result.success = result.sentCount > 0;
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(`Notification error: ${errorMessage}`);
    console.error('Notification error:', error);
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
    const result = await sendUpdateNotification(userId, updateData);
    results.push(result);
  }
  
  return results;
}