import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { testTelegramBot } from '@/utils/telegram';

/**
 * POST /api/notifications/test-telegram
 * Test Telegram bot configuration using the shared bot token
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { chatId, username } = await request.json();

    if (!chatId && !username) {
      return NextResponse.json({ 
        error: 'Chat ID or username is required' 
      }, { status: 400 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ 
        error: 'Telegram bot is not configured on the server. Please contact the administrator.' 
      }, { status: 500 });
    }

    // Test the Telegram bot configuration using the shared bot token
    const result = await testTelegramBot({ botToken, chatId: chatId || username });

    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Failed to send Telegram test message' 
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Telegram test message sent successfully'
    });

  } catch (error) {
    console.error('Telegram test error:', error);
    return NextResponse.json({ 
      error: 'Failed to test Telegram bot',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}