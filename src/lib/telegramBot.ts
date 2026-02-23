/* eslint-disable @typescript-eslint/no-explicit-any */
import { User, TrackedGame } from './models';
import connectDB from './db';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      first_name: string;
      username?: string;
      type: string;
    };
    date: number;
    text?: string;
  };
}

export interface TelegramCommand {
  command: string;
  args: string[];
  chatId: number;
  userId: number;
  messageId: number;
}

export class TelegramBotClient {
  private botToken: string;
  private baseUrl: string;

  constructor(botToken: string) {
    this.botToken = botToken;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(chatId: number, text: string, options?: {
    reply_to_message_id?: number;
    parse_mode?: 'HTML' | 'Markdown';
    disable_web_page_preview?: boolean;
  }): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...options,
        }),
      });

      return response.ok;
    } catch {
      console.error('Failed to send Telegram message');
      return false;
    }
  }

  async getMe(): Promise<{ ok: boolean; result?: any }> {
    try {
      const response = await fetch(`${this.baseUrl}/getMe`);
      return await response.json();
    } catch {
      console.error('Failed to get bot info');
      return { ok: false };
    }
  }

  async setWebhook(webhookUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/setWebhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: webhookUrl,
        }),
      });

      const result = await response.json();
      return result.ok;
    } catch {
      console.error('Failed to set webhook');
      return false;
    }
  }
}

export async function findUserByTelegramChat(chatId: number): Promise<any | null> {
  await connectDB();
  return await User.findOne({
    'preferences.notifications.telegramChatId': chatId.toString()
  });
}

export function parseCommand(text: string): TelegramCommand | null {
  if (!text || !text.startsWith('/')) {
    return null;
  }

  const parts = text.trim().split(/\s+/);
  const commandPart = parts[0].substring(1); // Remove the '/'
  const args = parts.slice(1);

  return {
    command: commandPart.toLowerCase(),
    args,
    chatId: 0, // Will be set by the caller
    userId: 0, // Will be set by the caller
    messageId: 0, // Will be set by the caller
  };
}

export async function handleTelegramCommand(
  command: TelegramCommand,
  user: any,
  botClient: TelegramBotClient
): Promise<void> {
  const { command: cmd, args, chatId } = command;

  try {
    switch (cmd) {
      case 'start':
        await botClient.sendMessage(
          chatId,
          `🎮 Welcome to AIOgames Bot!\n\nYou're connected as: ${user.name}\n\nAvailable commands:\n/update - Check for game updates\n/track <game title> - Track a new game\n/untrack <game title> - Untrack a game\n/search <query> - Search for games\n/list - Show your tracked games\n/id - Get your Telegram Chat ID\n/settings - Manage your settings\n/help - Show this help message`
        );
        break;

      case 'help':
        await botClient.sendMessage(
          chatId,
          `🤖 AIOgames Bot Commands:\n\n/update - Check all tracked games for updates\n/track <game title> - Add a game to tracking\n/untrack <game title> - Remove a game from tracking\n/search <query> - Search for games to track\n/list - Show all your tracked games\n/id - Get your Telegram Chat ID\n/settings - Open settings link\n/help - Show this help`
        );
        break;

      case 'id':
        await botClient.sendMessage(
          chatId,
          `🔑 Your Telegram Chat ID: <code>${chatId}</code>\n\n📋 You can use this ID in your AIOgames notification settings.`,
          { parse_mode: 'HTML' }
        );
        break;

      case 'update':
        await handleUpdateCommand(chatId, user, botClient);
        break;

      case 'track':
        await handleTrackCommand(chatId, args, user, botClient);
        break;

      case 'untrack':
        await handleUntrackCommand(chatId, args, user, botClient);
        break;

      case 'search':
        await handleSearchCommand(chatId, args, botClient);
        break;

      case 'list':
        await handleListCommand(chatId, user, botClient);
        break;

      case 'settings':
        await botClient.sendMessage(
          chatId,
          `⚙️ Manage your settings at: ${process.env.NEXTAUTH_URL}/user/manage`,
          { disable_web_page_preview: true }
        );
        break;

      default:
        await botClient.sendMessage(
          chatId,
          `❓ Unknown command: /${cmd}\n\nUse /help to see available commands.`
        );
        break;
    }
  } catch {
    console.error('Error handling Telegram command');
    await botClient.sendMessage(
      chatId,
      '❌ An error occurred while processing your command. Please try again later.'
    );
  }
}

async function handleUpdateCommand(chatId: number, user: any, botClient: TelegramBotClient): Promise<void> {
  await botClient.sendMessage(chatId, '🔄 Checking for updates...');

  try {
    // Call the real batch update check route (same one the scheduler uses)
    const baseUrl = process.env.NODE_ENV === 'production'
      ? process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
      : `http://127.0.0.1:${process.env.PORT || 3000}`;

    const response = await fetch(`${baseUrl}/api/updates/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Id': user._id.toString(),
      },
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Non-JSON response from update check');
      }

      const result = await response.json();
      const checked = result.checked || 0;
      const updatesFound = result.updatesFound || 0;

      if (updatesFound > 0) {
        await botClient.sendMessage(
          chatId,
          `✅ Update check complete!\n\n🎯 Found ${updatesFound} update(s) out of ${checked} games checked.\n\nCheck your dashboard for details: ${process.env.NEXTAUTH_URL || baseUrl}/tracking`,
          { disable_web_page_preview: true }
        );
      } else {
        await botClient.sendMessage(
          chatId,
          `✅ Update check complete!\n\n📋 No new updates found for your ${checked} tracked games.`
        );
      }
    } else {
      throw new Error(`Update check returned ${response.status}`);
    }
  } catch (error) {
    console.error('Telegram /update command error:', error);
    await botClient.sendMessage(
      chatId,
      '❌ Failed to check for updates. Please try again later.'
    );
  }
}

async function handleTrackCommand(chatId: number, args: string[], user: any, botClient: TelegramBotClient): Promise<void> {
  if (args.length === 0) {
    await botClient.sendMessage(
      chatId,
      '❓ Please provide a game title.\n\nExample: /track "Cyberpunk 2077"'
    );
    return;
  }

  const query = args.join(' ');
  await botClient.sendMessage(chatId, `🔍 Searching for "${query}"...`);

  try {
    const searchResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/games/search?search=${encodeURIComponent(query)}`);
    
    if (!searchResponse.ok) {
      throw new Error('Search failed');
    }

    const games = await searchResponse.json();
    
    if (games.length === 0) {
      await botClient.sendMessage(
        chatId,
        `❌ No games found for "${query}". Try a different search term.`
      );
      return;
    }

    const topGames = games.slice(0, 5);
    let message = `🎮 Found ${games.length} game(s) for "${query}":\n\n`;
    
    topGames.forEach((game: any, index: number) => {
      message += `${index + 1}. ${game.title}\n   Source: ${game.source}\n\n`;
    });

    message += `To track a specific game, use: /track "<exact title>"`;

    await botClient.sendMessage(chatId, message);

  } catch {
    await botClient.sendMessage(
      chatId,
      '❌ Failed to search for games. Please try again later.'
    );
  }
}

async function handleUntrackCommand(chatId: number, args: string[], user: any, botClient: TelegramBotClient): Promise<void> {
  if (args.length === 0) {
    await botClient.sendMessage(
      chatId,
      '❓ Please provide a game title.\n\nExample: /untrack "Cyberpunk 2077"'
    );
    return;
  }

  const gameTitle = args.join(' ').toLowerCase();

  try {
    await connectDB();
    const trackedGames = await TrackedGame.find({ 
      userId: user._id,
      isActive: true 
    });

    const gameToUntrack = trackedGames.find(game => 
      game.title.toLowerCase().includes(gameTitle) ||
      game.originalTitle.toLowerCase().includes(gameTitle)
    );

    if (!gameToUntrack) {
      await botClient.sendMessage(
        chatId,
        `❌ Game not found in your tracking list: "${args.join(' ')}"\n\nUse /list to see your tracked games.`
      );
      return;
    }

    // Untrack the game
    gameToUntrack.isActive = false;
    await gameToUntrack.save();

    await botClient.sendMessage(
      chatId,
      `✅ Successfully untracked: "${gameToUntrack.title}"`
    );

  } catch {
    await botClient.sendMessage(
      chatId,
      '❌ Failed to untrack game. Please try again later.'
    );
  }
}

async function handleSearchCommand(chatId: number, args: string[], botClient: TelegramBotClient): Promise<void> {
  if (args.length === 0) {
    await botClient.sendMessage(
      chatId,
      '❓ Please provide a search query.\n\nExample: /search "Cyberpunk"'
    );
    return;
  }

  const query = args.join(' ');
  await botClient.sendMessage(chatId, `🔍 Searching for "${query}"...`);

  try {
    const response = await fetch(`${process.env.NEXTAUTH_URL}/api/games/search?search=${encodeURIComponent(query)}`);
    
    if (!response.ok) {
      throw new Error('Search failed');
    }

    const games = await response.json();
    
    if (games.length === 0) {
      await botClient.sendMessage(
        chatId,
        `❌ No games found for "${query}". Try a different search term.`
      );
      return;
    }

    const topGames = games.slice(0, 10);
    let message = `🎮 Found ${games.length} game(s) for "${query}":\n\n`;
    
    topGames.forEach((game: any, index: number) => {
      message += `${index + 1}. ${game.title}\n   Source: ${game.source}\n   To track: /track "${game.title}"\n\n`;
    });

    if (games.length > 10) {
      message += `... and ${games.length - 10} more results.\n\n`;
    }

    await botClient.sendMessage(chatId, message);

  } catch {
    await botClient.sendMessage(
      chatId,
      '❌ Failed to search for games. Please try again later.'
    );
  }
}

async function handleListCommand(chatId: number, user: any, botClient: TelegramBotClient): Promise<void> {
  try {
    await connectDB();
    const trackedGames = await TrackedGame.find({ 
      userId: user._id,
      isActive: true 
    }).sort({ dateAdded: -1 }).limit(20);

    if (trackedGames.length === 0) {
      await botClient.sendMessage(
        chatId,
        '📋 You are not tracking any games yet.\n\nUse /search to find games to track!'
      );
      return;
    }

    let message = `📋 Your tracked games (${trackedGames.length}):\n\n`;
    
    trackedGames.forEach((game: any, index: number) => {
      const hasUpdate = game.hasNewUpdate && !game.newUpdateSeen;
      const updateIcon = hasUpdate ? '🔴' : '✅';
      message += `${updateIcon} ${index + 1}. ${game.title}\n   Source: ${game.source}\n`;
      
      if (hasUpdate) {
        message += '   📢 New update available!\n';
      }
      
      message += '\n';
    });

    message += `\nView full details: ${process.env.NEXTAUTH_URL}/tracking`;

    await botClient.sendMessage(chatId, message, { disable_web_page_preview: true });

  } catch {
    await botClient.sendMessage(
      chatId,
      '❌ Failed to load your tracked games. Please try again later.'
    );
  }
}