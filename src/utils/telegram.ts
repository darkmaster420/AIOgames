/**
 * Telegram Bot API utilities for sending notifications
 * Each user can configure their own Telegram bot for person  let text = '';
  
  // Check if this is a user-approved update
  if (changeType === 'user_approved') {
    text += `🎯 <b>New Update Approved!</b>\n\n`;
  } else {
    text += `🎮 <b>New Pending Update!</b>\n\n`;
  }

  text += `📍 <b>${title}</b>\n`;
  
  if (version) {
    text += `🆕 <b>New Version:</b> ${version}\n`;
    if (previousVersion && previousVersion !== version) {
      text += `🔄 <b>Current Version:</b> ${previousVersion}\n`;
    }
  }
  
  text += `🌐 <b>Source:</b> ${source || 'Unknown'}\n`;
  
  if (changeType && changeType !== 'unknown') {
    const typeText = changeType === 'user_approved' 
      ? 'Approved Update'
      : changeType === 'update' 
        ? 'Version Update' 
        : changeType.replace('_', ' ');
    text += `📝 <b>Type:</b> ${typeText}\n`;
  }tions
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramMessage {
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disable_web_page_preview?: boolean;
}

export interface TelegramPhotoMessage {
  photo: string;
  caption: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

// Cache for bot info to avoid repeated API calls
let cachedBotInfo: { username: string; timestamp: number } | null = null;
const BOT_INFO_CACHE_TTL = 3600000; // 1 hour in milliseconds

/**
 * Get bot information from Telegram API
 * Results are cached for 1 hour to avoid unnecessary API calls
 */
export async function getBotInfo(botToken?: string): Promise<{ username: string; botLink: string } | null> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    return null;
  }

  // Return cached info if valid
  if (cachedBotInfo && Date.now() - cachedBotInfo.timestamp < BOT_INFO_CACHE_TTL) {
    return {
      username: cachedBotInfo.username,
      botLink: `https://t.me/${cachedBotInfo.username}`
    };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/getMe`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Failed to fetch bot info:', response.status);
      return null;
    }

    const data = await response.json();
    
    if (data.ok && data.result?.username) {
      // Cache the result
      cachedBotInfo = {
        username: data.result.username,
        timestamp: Date.now()
      };

      return {
        username: data.result.username,
        botLink: `https://t.me/${data.result.username}`
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching bot info:', error);
    return null;
  }
}

/**
 * Send a photo message via Telegram Bot API
 */
export async function sendTelegramPhoto(
  config: TelegramConfig, 
  message: TelegramPhotoMessage
): Promise<{ success: boolean; error?: string }> {
  if (!config.botToken || !config.chatId) {
    return { success: false, error: 'Bot token and chat ID are required' };
  }

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendPhoto`;
    
    const payload = {
      chat_id: config.chatId,
      photo: message.photo,
      caption: message.caption,
      parse_mode: message.parse_mode || 'HTML'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.description || `HTTP ${response.status}`;
      console.error('Telegram API error:', errorMessage);
      return { success: false, error: errorMessage };
    }

    await response.json();
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Telegram send photo error:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(
  config: TelegramConfig, 
  message: TelegramMessage
): Promise<{ success: boolean; error?: string }> {
  if (!config.botToken || !config.chatId) {
    return { success: false, error: 'Bot token and chat ID are required' };
  }

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    
    const payload = {
      chat_id: config.chatId,
      text: message.text,
      parse_mode: message.parse_mode || 'HTML',
      disable_web_page_preview: message.disable_web_page_preview ?? true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.description || `HTTP ${response.status}`;
      console.error('Telegram API error:', errorMessage);
      return { success: false, error: errorMessage };
    }

    await response.json();
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Telegram send error:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Test if Telegram bot configuration is valid
 */
export async function testTelegramBot(config: TelegramConfig): Promise<{ success: boolean; error?: string }> {
  if (!config.botToken) {
    return { success: false, error: 'Bot token is required' };
  }

  try {
    // First test: Get bot info to verify token
    const botInfoUrl = `https://api.telegram.org/bot${config.botToken}/getMe`;
    const botResponse = await fetch(botInfoUrl);
    
    if (!botResponse.ok) {
      const errorData = await botResponse.json().catch(() => null);
      return { success: false, error: errorData?.description || 'Invalid bot token' };
    }

    const botInfo = await botResponse.json();
    if (!botInfo.ok) {
      return { success: false, error: botInfo.description || 'Bot token validation failed' };
    }

    // If chat ID is provided, test sending a message
    if (config.chatId) {
      const testMessage = {
        text: `🎮 <b>AIOgames Notification Test</b>\n\nYour Telegram bot is configured correctly!\n\nBot: @${botInfo.result.username || 'Unknown'}\nTime: ${new Date().toLocaleString()}`,
        parse_mode: 'HTML' as const
      };

      return await sendTelegramMessage(config, testMessage);
    }

    // Token is valid but no chat ID to test
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Telegram test error:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Format game update notification for Telegram with optional poster
 */
export function formatGameUpdateMessage(gameData: {
  title: string;
  version?: string;
  previousVersion?: string;
  gameLink: string;
  source: string;
  changeType?: string;
  downloadLinks?: Array<{ service: string; url: string; type?: string }>;
  imageUrl?: string;
}): TelegramMessage | TelegramPhotoMessage {
  const { title, version, previousVersion, gameLink, source, changeType, downloadLinks, imageUrl } = gameData;
  
  // Set message header and icon based on type
  let text = '';
  
  // Set header based on update status
  if (changeType === 'user_approved' || changeType === 'automatic') {
    text = `✅ <b>Update Approved!</b>\n\n`;
  } else if (changeType === 'pending') {
    text = `🔔 <b>New Pending Update!</b>\n\n`;
  } else {
    text = `🎮 <b>New Update Found!</b>\n\n`;
  }

  // Game title and version info
  text += `📍 <b>${title}</b>\n`;
  if (version) {
    // Extract clean version/build information from the full post title
    let cleanVersion = version;
    
    // Try to extract build number (e.g., "Build 20440670" or "Build #12345")
    const buildMatch = version.match(/(?:Build|build)\s*[#:]?\s*(\d+)/i);
    if (buildMatch) {
      cleanVersion = `Build #${buildMatch[1]}`;
    } else {
      // Try to extract version number (e.g., "v1.2.3" or "1.2.3")
      const versionMatch = version.match(/v?(\d+\.\d+(?:\.\d+)*(?:[a-z])?)/i);
      if (versionMatch) {
        cleanVersion = `v${versionMatch[1]}`;
      } else {
        // If no clear build/version found, try to clean up the title
        // Remove common prefixes and suffixes
        cleanVersion = version
          .replace(/^.*?:\s*/i, '') // Remove "Game Name: " prefix
          .replace(/\s*[\[\(].*?[\]\)]\s*/g, ' ') // Remove bracketed content
          .replace(/\s*-\s*update/i, '') // Remove " - Update"
          .replace(/\s+/g, ' ')
          .trim();
        
        // If result is too long, just take first part
        if (cleanVersion.length > 50) {
          cleanVersion = cleanVersion.substring(0, 47) + '...';
        }
      }
    }
    
    if (previousVersion && previousVersion !== version) {
      text += `🆕 <b>New Version:</b> ${cleanVersion}\n`;
      if (previousVersion) {
        // Also try to clean the previous version
        const prevBuildMatch = previousVersion.match(/(?:Build|build)\s*[#:]?\s*(\d+)/i);
        const prevVersionMatch = previousVersion.match(/v?(\d+\.\d+(?:\.\d+)*(?:[a-z])?)/i);
        const cleanPrevious = prevBuildMatch 
          ? `Build #${prevBuildMatch[1]}`
          : prevVersionMatch
            ? `v${prevVersionMatch[1]}`
            : previousVersion;
        text += `🔄 <b>Previous:</b> ${cleanPrevious}\n`;
      }
    } else {
      text += `🆕 <b>Version:</b> ${cleanVersion}\n`;
    }
  }
  
  // Source and status
  text += `🌐 <b>Source:</b> ${source || 'Game Tracker'}\n`;
  if (changeType === 'user_approved' || changeType === 'automatic') {
    text += `📥 <b>Status:</b> Ready to Download\n`;
    if (changeType === 'automatic') {
      text += `🤖 <b>Note:</b> Auto-approved update\n`;
    }
  } else if (changeType === 'pending') {
    text += `⏳ <b>Status:</b> Pending Approval\n`;
    text += `📝 <b>Action Required:</b> Review and approve in your tracking page\n`;
  } else if (changeType && changeType !== 'unknown') {
    text += `📝 <b>Type:</b> ${changeType === 'update' ? 'Version Update' : changeType.replace('_', ' ')}\n`;
  }
  
  // Customize link text based on update type
  if (changeType === 'user_approved' || changeType === 'automatic') {
    text += `\n🔗 <a href="${gameLink || '/tracking'}">Download Now</a>`;
  } else if (changeType === 'pending') {
    text += `\n🔗 <a href="${gameLink || '/tracking'}">Review & Approve Update</a>`;
  } else {
    text += `\n🔗 <a href="${gameLink || '/tracking'}">View Update</a>`;
  }
  
  console.log(`📥 Processing download links in Telegram formatter:`, downloadLinks);
  // Only show download links for approved updates
  if ((changeType === 'user_approved' || changeType === 'automatic') && downloadLinks && downloadLinks.length > 0) {
    text += `\n\n📥 <b>Download Links:</b>\n`;
    downloadLinks.forEach(link => {
      // Format based on link type
      const typeLabel = link.type === 'magnet' ? 'torrent' : link.type || 'hosting';
      // Make each link clickable with service name
      text += `• <a href="${link.url}">${link.service}</a> (${typeLabel})\n`;
    });
  }
  
  // Add timestamp
  text += `\n\n⏰ ${new Date().toLocaleString('en-US', { 
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })}`;
  
  // Return photo message if image URL is provided, otherwise text message
  if (imageUrl) {
    return {
      photo: imageUrl,
      caption: text,
      parse_mode: 'HTML'
    };
  }
  
  return {
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
}

/**
 * Format sequel notification for Telegram
 */
export function formatSequelNotificationMessage(sequelData: {
  originalTitle: string;
  detectedTitle: string;
  sequelType: string;
  gameLink: string;
  source: string;
  similarity: number;
}): TelegramMessage {
  const { originalTitle, detectedTitle, sequelType, gameLink, source, similarity } = sequelData;
  
  let text = `🎯 <b>Sequel Detected!</b>\n\n`;
  text += `🎮 <b>Original:</b> ${originalTitle}\n`;
  text += `✨ <b>Sequel:</b> ${detectedTitle}\n`;
  text += `📋 <b>Type:</b> ${sequelType.replace('_', ' ')}\n`;
  text += `🌐 <b>Source:</b> ${source}\n`;
  text += `🎯 <b>Match:</b> ${Math.round(similarity * 100)}%\n`;
  text += `\n🔗 <a href="${gameLink}">View Sequel</a>`;
  text += `\n⏰ ${new Date().toLocaleString()}`;
  
  return {
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
}

/**
 * Get user's Telegram configuration from user data
 * Uses shared bot token from environment variable
 * Telegram is enabled if notifyImmediately is true and chatId is provided
 */
export function getTelegramConfig(user: { preferences?: { notifications?: { notifyImmediately?: boolean; telegramUsername?: string; telegramChatId?: string } } }): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = user?.preferences?.notifications?.telegramChatId;
  const notifyImmediately = user?.preferences?.notifications?.notifyImmediately;

  // Telegram is enabled if user wants immediate notifications and has a chat ID configured
  if (!botToken || !chatId || !notifyImmediately) {
    return null;
  }

  return { botToken, chatId };
}