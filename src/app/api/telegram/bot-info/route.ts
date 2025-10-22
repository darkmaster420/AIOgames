import { NextResponse } from 'next/server';
import { getBotInfo } from '../../../../utils/telegram';

/**
 * GET endpoint to retrieve the configured Telegram bot information
 * Returns the bot username and t.me link
 */
export async function GET() {
  try {
    const botInfo = await getBotInfo();

    if (!botInfo) {
      return NextResponse.json(
        { error: 'Telegram bot not configured or unavailable' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      username: botInfo.username,
      botLink: botInfo.botLink,
      configured: true
    });
  } catch (error) {
    console.error('Error fetching bot info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bot information' },
      { status: 500 }
    );
  }
}
