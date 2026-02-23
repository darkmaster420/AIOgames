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
  const { title, version, gameLink, source, changeType, downloadLinks, imageUrl } = gameData;
  
  // Simple clean header
  let text = '';
  if (changeType === 'pending') {
    text = `🔔 <b>New Pending Update!</b>\n\n`;
  } else {
    text = `✅ <b>New Update!</b>\n\n`;
  }

  // Game title
  text += `📍 <b>${title}</b>\n`;
  
  // Version/build
  if (version) {
    // Extract clean version/build
    let cleanVersion = version;
    const buildMatch = version.match(/(?:Build|build)\s*[#:]?\s*(\d+)/i);
    if (buildMatch) {
      cleanVersion = `Build #${buildMatch[1]}`;
    } else {
      const versionMatch = version.match(/v?(\d+\.\d+(?:\.\d+)*(?:[a-z])?)/i);
      if (versionMatch) {
        cleanVersion = `v${versionMatch[1]}`;
      } else {
        // Try date-based version (e.g., v20260222)
        const dateMatch = version.match(/v?(\d{8})/);
        if (dateMatch) {
          cleanVersion = `v${dateMatch[1]}`;
        } else {
          cleanVersion = version.length > 50 ? version.substring(0, 47) + '...' : version;
        }
      }
    }
    text += `🆕 <b>Version:</b> ${cleanVersion}\n`;
  }
  
  // Source as a clickable link to the original post
  const sourceName = source || 'Unknown';
  if (gameLink && gameLink !== '/tracking') {
    text += `🔗 <b>Source:</b> <a href="${gameLink}">${sourceName}</a>\n`;
  } else {
    text += `🔗 <b>Source:</b> ${sourceName}\n`;
  }

  // Pending action note
  if (changeType === 'pending') {
    text += `\n⏳ <b>Action Required:</b> Review and approve in your tracking page\n`;
  }
  
  // Download links for approved updates
  if (changeType !== 'pending' && downloadLinks && downloadLinks.length > 0) {
    text += `\n📥 <b>Download Links:</b>\n`;
    downloadLinks.forEach(link => {
      const typeLabel = link.type === 'magnet' ? 'torrent' : link.type || 'hosting';
      text += `• <a href="${link.url}">${link.service}</a> (${typeLabel})\n`;
    });
  }
  
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