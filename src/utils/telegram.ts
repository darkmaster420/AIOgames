/**
 * Telegram Bot API utilities for sending notifications
 * Each user can configure their own Telegram bot for personalized notifications
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

    const result = await response.json();
    console.log('✅ Telegram message sent successfully:', result.message_id);
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
 * Format game update notification for Telegram
 */
export function formatGameUpdateMessage(gameData: {
  title: string;
  version?: string;
  previousVersion?: string;
  gameLink: string;
  source: string;
  changeType?: string;
  downloadLinks?: Array<{ service: string; url: string; type?: string }>;
}): TelegramMessage {
  const { title, version, previousVersion, gameLink, source, changeType, downloadLinks } = gameData;
  
  let text = `🎮 <b>Game Update Available!</b>\n\n`;
  text += `📍 <b>${title}</b>\n`;
  
  if (version) {
    text += `🆕 <b>Version:</b> ${version}\n`;
    if (previousVersion && previousVersion !== version) {
      text += `🔄 <b>Previous:</b> ${previousVersion}\n`;
    }
  }
  
  text += `🌐 <b>Source:</b> ${source}\n`;
  
  if (changeType && changeType !== 'unknown') {
    text += `📝 <b>Change:</b> ${changeType.replace('_', ' ')}\n`;
  }
  
  text += `\n🔗 <a href="${gameLink}">View Game</a>`;
  
  if (downloadLinks && downloadLinks.length > 0) {
    text += `\n\n📥 <b>Downloads:</b>\n`;
    downloadLinks.forEach(link => {
      text += `• <a href="${link.url}">${link.service}</a>\n`;
    });
  }
  
  text += `\n⏰ ${new Date().toLocaleString()}`;
  
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
 */
export function getTelegramConfig(user: { preferences?: { notifications?: { telegramEnabled?: boolean; telegramBotToken?: string; telegramChatId?: string } } }): TelegramConfig | null {
  if (!user?.preferences?.notifications?.telegramEnabled) {
    return null;
  }

  const botToken = user.preferences.notifications.telegramBotToken;
  const chatId = user.preferences.notifications.telegramChatId;

  if (!botToken || !chatId) {
    return null;
  }

  return { botToken, chatId };
}