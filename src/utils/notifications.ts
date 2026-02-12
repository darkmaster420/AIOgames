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

// Rate limiting for Telegram notifications to prevent API limits
const telegramRateLimit = new Map<string, number>(); // userId -> lastSentTime

// Deduplication cache to prevent sending duplicate notifications
const notificationCache = new Map<string, number>(); // cacheKey -> timestamp
const DEDUP_WINDOW_MS = 60000; // 1 minute deduplication window

/**
 * Generate a cache key for deduplication
 */
function getNotificationCacheKey(userId: string, gameTitle: string, version?: string, updateType?: string): string {
  return `${userId}:${gameTitle}:${version || 'none'}:${updateType || 'update'}`;
}

/**
 * Check if this notification was recently sent (within dedup window)
 */
function wasRecentlySent(cacheKey: string): boolean {
  const lastSent = notificationCache.get(cacheKey);
  if (!lastSent) return false;
  
  const timeSince = Date.now() - lastSent;
  if (timeSince < DEDUP_WINDOW_MS) {
    console.log(`[Notifications] Skipping duplicate notification (sent ${Math.round(timeSince/1000)}s ago): ${cacheKey}`);
    return true;
  }
  
  // Clean up old entry
  notificationCache.delete(cacheKey);
  return false;
}

/**
 * Mark notification as sent
 */
function markNotificationSent(cacheKey: string): void {
  notificationCache.set(cacheKey, Date.now());
  
  // Clean up old entries periodically (keep cache from growing indefinitely)
  if (notificationCache.size > 1000) {
    const now = Date.now();
    for (const [key, timestamp] of notificationCache.entries()) {
      if (now - timestamp > DEDUP_WINDOW_MS * 2) {
        notificationCache.delete(key);
      }
    }
  }
}

/**
 * Add delay between Telegram notifications to prevent rate limiting
 */
async function addTelegramDelay(userId: string): Promise<void> {
  const lastSent = telegramRateLimit.get(userId) || 0;
  const timeSinceLastSent = Date.now() - lastSent;
  const requiredDelay = 5000; // 5 seconds between messages
  
  if (timeSinceLastSent < requiredDelay) {
    const delayNeeded = requiredDelay - timeSinceLastSent;
    console.log(`[Notifications] Adding ${delayNeeded}ms delay for Telegram rate limiting (user: ${userId})`);
    await new Promise(resolve => setTimeout(resolve, delayNeeded));
  }
  
  telegramRateLimit.set(userId, Date.now());
}

export interface UpdateNotificationData {
  gameTitle: string;
  steamName?: string;
  gogName?: string;
  version?: string;
  updateType: 'update' | 'sequel' | 'pending';
  gameLink?: string;
  imageUrl?: string;
  downloadLinks?: Array<{ service: string; url: string; type?: string }>;
  previousVersion?: string;
  isPending?: boolean;
  source?: string;
}

/**
 * Helper function to create properly formatted notification data
 */
export function createUpdateNotificationData(params: {
  gameTitle: string;
  steamName?: string;
  gogName?: string;
  version?: string;
  updateType: 'update' | 'sequel' | 'pending';
  gameLink?: string;
  imageUrl?: string;
  downloadLinks?: Array<{ service: string; url: string; type?: string }>;
  previousVersion?: string;
  isPending?: boolean;
  source?: string;
}): UpdateNotificationData {
  return {
    gameTitle: params.gameTitle,
    steamName: params.steamName,
    gogName: params.gogName,
    version: params.version,
    updateType: params.updateType,
    gameLink: params.gameLink,
    imageUrl: params.imageUrl,
    downloadLinks: params.isPending ? undefined : params.downloadLinks, // Don't include download links for pending updates
    previousVersion: params.previousVersion,
    isPending: params.isPending,
    source: params.source,
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

  // Check for duplicate notification
  const cacheKey = getNotificationCacheKey(userId, updateData.gameTitle, updateData.version, updateData.updateType);
  if (wasRecentlySent(cacheKey)) {
    console.log(`[Notifications] Skipping duplicate notification for ${updateData.gameTitle}`);
    return {
      userId,
      success: true,
      sentCount: 0,
      failedCount: 0,
      errors: ['Duplicate notification (already sent recently)'],
      methods: {
        webpush: { sent: 0, failed: 0, errors: [] },
        telegram: { sent: 0, failed: 0, errors: [] }
      }
    };
  }

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
    
    
    // Processing notifications for user        // Send Telegram notification if configured (provider is telegram OR chat ID is set)
    const telegramConfig = getTelegramConfig(user);
    if (telegramConfig && (provider === 'telegram' || notificationPrefs?.telegramChatId)) {
        // Got valid Telegram config
        try {
          console.log(`[Notifications] Sending Telegram notification for ${updateData.gameTitle} to user ${userId}`);
          
          // Add rate limiting delay before sending
          await addTelegramDelay(userId);
          
          // Determine the best title to display (Steam > GOG > cleaned title)
          const displayTitle = updateData.steamName || updateData.gogName || updateData.gameTitle;
          
          const message = updateData.updateType === 'sequel'
            ? formatSequelNotificationMessage({
                originalTitle: displayTitle,
                detectedTitle: updateData.version || 'Unknown Title',
                sequelType: 'sequel',
                gameLink: updateData.gameLink || '/tracking',
                source: updateData.source || 'Game Tracker',
                similarity: 1.0
              })
            : formatGameUpdateMessage({
                title: displayTitle,
                version: updateData.version,
                previousVersion: updateData.previousVersion,
                gameLink: updateData.gameLink || '/tracking',
                source: updateData.source || 'Game Tracker',
                changeType: updateData.isPending ? 'pending' : 'automatic', // Use 'pending' for pending updates
                downloadLinks: updateData.isPending ? undefined : updateData.downloadLinks, // Don't send download links for pending
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
    } else if (provider === 'telegram' || notificationPrefs?.telegramChatId) {
      console.log(`[Notifications] Telegram config missing for user ${userId} - chatId: ${!!notificationPrefs?.telegramChatId}, notifyImmediately: ${!!notificationPrefs?.notifyImmediately}`);
      result.methods.telegram.errors.push('Telegram not properly configured or immediate notifications disabled');
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
    
    // Mark as sent in deduplication cache if we successfully sent any notifications
    if (result.success) {
      markNotificationSent(cacheKey);
    }
    
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