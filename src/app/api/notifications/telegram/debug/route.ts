import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { User } from '@/lib/models';
import { getTelegramConfig, testTelegramBot } from '@/utils/telegram';
import connectDB from '@/lib/db';

/**
 * GET /api/notifications/telegram/debug
 * Debug Telegram notification configuration
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get current user
    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const notificationPrefs = user.preferences?.notifications;
    const telegramConfig = getTelegramConfig(user);

    const debug = {
      userId: user._id,
      preferences: {
        notifyImmediately: user.preferences?.notifications?.notifyImmediately || false,
        provider: notificationPrefs?.provider || 'none',
        hasBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
        hasSharedBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
        hasChatId: !!notificationPrefs?.telegramChatId,
        chatIdLength: notificationPrefs?.telegramChatId?.length || 0,
        username: notificationPrefs?.telegramUsername || 'not set'
      },
      configValid: !!telegramConfig,
      telegramConfig: telegramConfig ? {
        hasBotToken: !!telegramConfig.botToken,
        hasChatId: !!telegramConfig.chatId
      } : null
    };

    // Test configuration if valid
    let testResult = null;
    if (telegramConfig) {
      try {
        testResult = await testTelegramBot(telegramConfig);
      } catch (error) {
        testResult = { 
          success: false, 
          error: error instanceof Error ? error.message : 'Test failed' 
        };
      }
    }

    return NextResponse.json({
      debug,
      testResult,
      recommendations: getRecommendations(debug, testResult)
    });

  } catch (error) {
    console.error('Telegram debug error:', error);
    return NextResponse.json(
      { error: 'Debug failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function getRecommendations(debug: {
  preferences: {
    notifyImmediately: boolean;
    hasBotToken: boolean;
    hasChatId: boolean;
    provider: string;
  };
  configValid: boolean;
}, testResult: { success: boolean; error?: string } | null): string[] {
  const recommendations = [];

  if (!debug.preferences.notifyImmediately) {
    recommendations.push('Enable immediate notifications in your user preferences to use Telegram');
  }

  if (!debug.preferences.hasBotToken) {
    recommendations.push('Telegram bot token is not configured on the server. Contact the administrator.');
  }

  if (!debug.preferences.hasChatId) {
    recommendations.push('Add your Telegram chat ID in notification settings (send /start to the bot)');
  }

  if (debug.configValid && testResult && !testResult.success) {
    recommendations.push(`Fix Telegram configuration: ${testResult.error}`);
  }

  if (debug.preferences.provider !== 'telegram' && debug.preferences.hasChatId && debug.preferences.notifyImmediately) {
    recommendations.push('Consider setting Telegram as your primary notification provider');
  }

  return recommendations;
}