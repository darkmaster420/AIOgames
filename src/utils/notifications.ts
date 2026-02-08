import { User } from '../lib/models';
import { sendNotifications } from './appriseNotifier';

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
    downloadLinks: params.isPending ? undefined : params.downloadLinks,
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
}

/**
 * Format notification content based on update type
 */
function formatNotificationContent(updateData: UpdateNotificationData): { title: string; body: string } {
  const displayTitle = updateData.steamName || updateData.gogName || updateData.gameTitle;
  
  if (updateData.updateType === 'sequel') {
    return {
      title: '🎮 New Sequel Detected!',
      body: `A sequel or related game to "${displayTitle}" has been found!\n\nDetected: ${updateData.version || 'Unknown Title'}`
    };
  }
  
  if (updateData.isPending) {
    return {
      title: '🔔 Pending Update Found',
      body: `A potential update for "${displayTitle}" requires your approval.\n\n${updateData.version ? `Version: ${updateData.version}` : ''}`
    };
  }
  
  // Regular update
  let body = `"${displayTitle}" has been updated!`;
  
  if (updateData.version) {
    body += `\n\n🆕 New Version: ${updateData.version}`;
  }
  
  if (updateData.previousVersion && updateData.previousVersion !== updateData.version) {
    body += `\n🔄 Previous: ${updateData.previousVersion}`;
  }
  
  if (updateData.source) {
    body += `\n🌐 Source: ${updateData.source}`;
  }
  
  if (updateData.downloadLinks && updateData.downloadLinks.length > 0) {
    body += '\n\n📥 Download Links:\n';
    updateData.downloadLinks.slice(0, 3).forEach(link => {
      body += `• ${link.service}: ${link.url}\n`;
    });
  }
  
  return {
    title: '🔄 Game Update Available!',
    body
  };
}

/**
 * Send update notifications to a specific user via Apprise
 */
export async function sendUpdateNotification(
  userId: string,
  updateData: UpdateNotificationData
): Promise<NotificationResult> {
  console.log(`[Notifications] Starting Apprise notification for user ${userId}`, {
    gameTitle: updateData.gameTitle,
    updateType: updateData.updateType,
    version: updateData.version
  });

  const result: NotificationResult = {
    userId,
    success: false,
    sentCount: 0,
    failedCount: 0,
    errors: []
  };

  try {
    // Get user data
    const user = await User.findById(userId);
    if (!user) {
      console.error(`[Notifications] User not found: ${userId}`);
      result.errors.push('User not found');
      return result;
    }

    // Check if user wants immediate notifications
    if (!user.preferences?.notifications?.notifyImmediately) {
      console.log(`[Notifications] User ${userId} has disabled immediate notifications`);
      return result;
    }

    // Get Apprise URLs from user preferences
    const appriseUrls = user.preferences?.notifications?.appriseUrls || [];
    
    if (appriseUrls.length === 0) {
      console.log(`[Notifications] User ${userId} has no Apprise URLs configured`);
      result.errors.push('No notification URLs configured');
      return result;
    }

    // Format notification content
    const { title, body } = formatNotificationContent(updateData);
    
    // Send via Apprise
    const appriseResult = await sendNotifications(appriseUrls, {
      title,
      body,
      imageUrl: updateData.imageUrl,
      url: updateData.gameLink,
      format: 'text'
    });

    result.success = appriseResult.success;
    result.sentCount = appriseResult.sentCount;
    result.failedCount = appriseResult.failedCount;
    
    // Collect errors
    appriseResult.results.forEach(r => {
      if (!r.success && r.error) {
        result.errors.push(`${r.service}: ${r.error}`);
      }
    });

    if (result.success) {
      console.log(`[Notifications] Successfully sent to ${result.sentCount}/${appriseUrls.length} services for user ${userId}`);
    } else {
      console.error(`[Notifications] Failed to send notifications for user ${userId}:`, result.errors);
    }

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Notifications] Error sending notification for user ${userId}:`, error);
    result.errors.push(errorMessage);
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