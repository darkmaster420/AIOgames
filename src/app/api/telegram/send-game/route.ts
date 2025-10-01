import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { sendTelegramMessage } from '../../../../utils/telegram';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { game } = await request.json();
    
    if (!game || !game.title || !game.link) {
      return NextResponse.json(
        { error: 'Game data with title and link is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Get user's Telegram configuration
    const dbUser = await User.findById(user.id);
    
    if (!dbUser || !dbUser.preferences?.notifications?.telegramBotToken || !dbUser.preferences?.notifications?.telegramChatId) {
      return NextResponse.json(
        { error: 'Telegram not configured. Please set up your Telegram bot in user settings.' },
        { status: 400 }
      );
    }

    // Check if Telegram is enabled
    if (!dbUser.preferences.notifications.telegramEnabled) {
      return NextResponse.json(
        { error: 'Telegram notifications are disabled. Please enable them in user settings.' },
        { status: 400 }
      );
    }

    // Format the game message for Telegram
    const telegramConfig = {
      botToken: dbUser.preferences.notifications.telegramBotToken,
      chatId: dbUser.preferences.notifications.telegramChatId
    };

    // Create formatted message
    let messageText = `🎮 <b>Game from AIOGames</b>\n\n`;
    messageText += `📍 <b>${game.title}</b>\n`;
    
    if (game.description) {
      // Clean and truncate description
      const cleanDescription = game.description
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&[^;]+;/g, ' ') // Remove HTML entities
        .trim();
      
      if (cleanDescription.length > 200) {
        messageText += `📝 ${cleanDescription.substring(0, 200)}...\n`;
      } else if (cleanDescription.length > 0) {
        messageText += `📝 ${cleanDescription}\n`;
      }
    }
    
    messageText += `🌐 <b>Source:</b> ${game.source || game.siteType || 'Unknown'}\n`;
    messageText += `🔗 <b>Link:</b> <a href="${game.link}">View Game</a>\n`;
    
    if (game.image) {
      messageText += `🖼️ <a href="${game.image}">Preview Image</a>\n`;
    }
    
    messageText += `\n💡 <i>Sent from AIOGames Tracker</i>`;

    // Send the message
    const result = await sendTelegramMessage(telegramConfig, {
      text: messageText,
      parse_mode: 'HTML',
      disable_web_page_preview: false // Allow preview for game links
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Failed to send to Telegram: ${result.error}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Game sent to Telegram successfully!' 
    });

  } catch (error) {
    console.error('Send to Telegram error:', error);
    return NextResponse.json(
      { error: 'Failed to send game to Telegram' },
      { status: 500 }
    );
  }
}