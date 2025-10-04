import { NextRequest, NextResponse } from 'next/server';
import { TelegramBotClient, TelegramUpdate, parseCommand, handleTelegramCommand, findUserByTelegramChat } from '../../../../lib/telegramBot';

export async function POST(request: NextRequest) {
  try {
    const update: TelegramUpdate = await request.json();
    
    if (!update.message?.text || !update.message.chat) {
      return NextResponse.json({ ok: true }); // Ignore non-text messages
    }

    const { message } = update;
    const chatId = message.chat.id;
    const text = message.text;

    // Find user by Telegram chat ID
    const user = await findUserByTelegramChat(chatId);
    
    if (!user) {
      // User not found - they need to set up their Telegram integration
      console.log(`Unlinked Telegram user attempted to use bot: Chat ID ${chatId}`);
      return NextResponse.json({ ok: true });
    }

    // Get the user's bot token and check if bot management is enabled
    const botToken = user.preferences?.notifications?.telegramBotToken;
    const botManagementEnabled = user.preferences?.notifications?.telegramBotManagementEnabled;
    
    if (!botToken) {
      console.log(`User ${user.email} has no bot token configured for Telegram`);
      return NextResponse.json({ ok: true });
    }

    const botClient = new TelegramBotClient(botToken);

    // Parse command if it's a command message
    if (text && text.startsWith('/')) {
      if (!botManagementEnabled) {
        // Bot management is disabled - send helpful message
        await botClient.sendMessage(
          chatId,
          `🤖 Bot management is currently disabled.\n\nTo enable bot commands, go to your AIOgames user settings and enable "Telegram Bot Management".\n\nYou can still receive notifications!`
        );
        return NextResponse.json({ ok: true });
      }
      
      const command = parseCommand(text);
      if (command) {
        command.chatId = chatId;
        command.userId = message.from.id;
        command.messageId = message.message_id;
        
        await handleTelegramCommand(command, user, botClient);
      }
    } else if (text) {
      // Handle non-command messages
      const helpText = botManagementEnabled 
        ? `👋 Hi! I'm your AIOgames bot.\n\nUse /help to see available commands.`
        : `👋 Hi! I'm your AIOgames bot.\n\n🔔 I'll send you game update notifications!\n\n💡 To enable bot commands like /track and /search, go to your AIOgames user settings and enable "Telegram Bot Management".`;
        
      await botClient.sendMessage(chatId, helpText);
    }

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error('Telegram webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  
  // Simple verification - you might want to make this more secure
  if (token === process.env.TELEGRAM_WEBHOOK_TOKEN) {
    return NextResponse.json({ status: 'Webhook verified' });
  }
  
  return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
}