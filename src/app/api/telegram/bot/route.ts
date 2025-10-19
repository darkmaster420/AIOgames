/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth-options';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';
import { TelegramBotClient } from '../../../../lib/telegramBot';

export async function POST(request: NextRequest) {
  return NextResponse.json({ success: true, message: 'Telegram bot management coming soon' });
}

export async function GET() {
  return NextResponse.json({ enabled: false, hasToken: false, hasChatId: false, chatId: '' });
}
