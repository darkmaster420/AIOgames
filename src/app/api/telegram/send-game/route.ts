import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';
import { TelegramBotClient } from '../../../../lib/telegramBot';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { game } = await request.json();
    
    if (!game || !game.title) {
      return NextResponse.json({ error: 'Game data is required' }, { status: 400 });
    }

    await connectDB();
    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if user has Telegram configured
    const telegramConfig = user.preferences?.notifications || {};
    
    if (!telegramConfig.telegramEnabled) {
      return NextResponse.json({ 
        error: 'Telegram notifications are not enabled. Please enable them in your user settings.' 
      }, { status: 400 });
    }

    const botToken = telegramConfig.telegramBotToken;
    const chatId = telegramConfig.telegramChatId;

    if (!botToken || !chatId) {
      return NextResponse.json({ 
        error: 'Telegram bot is not configured. Please set up your bot token and chat ID in user settings.' 
      }, { status: 400 });
    }

    // Send game info to Telegram
    const botClient = new TelegramBotClient(botToken);
    
    // Format the message
    let message = `🎮 Game Shared from AIOgames\n\n`;
    message += `**${game.title}**\n\n`;
    
    if (game.description) {
      const cleanDescription = game.description.replace(/<[^>]*>/g, '').substring(0, 200);
      message += `${cleanDescription}${game.description.length > 200 ? '...' : ''}\n\n`;
    }
    
    if (game.source) {
      message += `📋 Source: ${game.source}\n`;
    }
    
    message += `🔗 Link: ${game.link}\n\n`;
    message += `Sent via AIOgames Dashboard`;

    const success = await botClient.sendMessage(
      parseInt(chatId),
      message,
      { 
        parse_mode: 'Markdown',
        disable_web_page_preview: false 
      }
    );

    if (success) {
      return NextResponse.json({ 
        success: true, 
        message: 'Game sent to Telegram successfully' 
      });
    } else {
      return NextResponse.json({ 
        error: 'Failed to send message to Telegram. Please check your bot configuration.' 
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Telegram send game error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}
