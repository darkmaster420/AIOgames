import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { testTelegramBot } from '@/utils/telegram';

/**
 * POST /api/notifications/test-telegram
 * Test Telegram bot configuration
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botToken, chatId } = await request.json();

    if (!botToken || !chatId) {
      return NextResponse.json({ 
        error: 'Bot token and chat ID are required' 
      }, { status: 400 });
    }

    // Test the Telegram bot configuration
    const result = await testTelegramBot({ botToken, chatId });

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