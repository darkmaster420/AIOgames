import webpush from 'web-push';
import { User } from '../lib/models';
import { 
  sendTelegramMessage, 
  getTelegramConfig, 
  formatGameUpdateMessage, 
  formatSequelNotificationMessage 
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
}): UpdateNotificationData {
  return {
    gameTitle: params.gameTitle,
    version: params.version,
    updateType: params.updateType,
    gameLink: params.gameLink,
    imageUrl: params.imageUrl,
  };
}

interface NotificationResult {
  userId: string;
  success: boolean;
  sentCount: number;
  failedCount: number;
  errors: string[];
  methods: {
    webpush: { sent: number; failed: 0, errors: string[] };
    telegram: { sent: number; failed: 0, errors: string[] };
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

    // Default to true for immediate notifications if not set
    const notifyImmediately = user.preferences?.notifications?.notifyImmediately ?? true;
    
    console.log('[Notifications] User preferences:', {
      email: user.email,
      provider: user.preferences?.notifications?.provider,
      telegramEnabled: user.preferences?.notifications?.telegramEnabled,
      telegramConfigured: !!(user.preferences?.notifications?.telegramBotToken && user.preferences?.notifications?.telegramChatId),
      notifyImmediately
    });

    // Check if user wants immediate notifications
    if (!notifyImmediately) {
      console.log('[Notifications] User has disabled immediate notifications');
      result.errors.push('User has disabled immediate notifications');
      return result;
    }

    const notificationPrefs = user.preferences?.notifications;
    const provider = notificationPrefs?.provider || 'webpush';
    
    console.log(`[Notifications] Processing for user ${user.email}:`, {
      provider,
      telegramEnabled: notificationPrefs?.telegramEnabled,
      hasPreferences: !!user.preferences,
      hasNotificationPrefs: !!notificationPrefs,
      game: updateData.gameTitle,
      version: updateData.version
    });
    
    // Send Telegram notification if enabled and configured
    if ((provider === 'telegram' || notificationPrefs?.telegramEnabled) && notificationPrefs?.telegramEnabled) {
      console.log('[Notifications] Telegram conditions met, getting config...');
      const telegramConfig = getTelegramConfig(user);
      if (telegramConfig) {
        console.log('[Notifications] Got valid Telegram config:', {
          hasToken: !!telegramConfig.botToken,
          hasChatId: !!telegramConfig.chatId,
          tokenLength: telegramConfig.botToken?.length
        });
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
          } else {
            result.methods.telegram.failed++;
            result.failedCount++;
            result.methods.telegram.errors.push(telegramResult.error || 'Unknown Telegram error');
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
        console.warn(`⚠️ Telegram config missing for user ${user.email}`);
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