import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { getCurrentUser } from '../../../../lib/auth';
import { User } from '../../../../lib/models';

export async function PATCH(req: Request) {
  try {
    const profile = await getCurrentUser();
    if (!profile) return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });

    const body = await req.json();
    await connectDB();
    const user = await User.findById(profile.id);
    if (!user) return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });

    user.preferences ||= {};
    user.preferences.notifications ||= {};
    user.preferences.releaseGroups ||= {};
    user.preferences.homepage ||= {};

    if (typeof body.provider === 'string') user.preferences.notifications.provider = body.provider;
    if (typeof body.webpushEnabled === 'boolean') user.preferences.notifications.webpushEnabled = body.webpushEnabled;
    if (typeof body.notifyImmediately === 'boolean') user.preferences.notifications.notifyImmediately = body.notifyImmediately;
    if (typeof body.telegramUsername === 'string') user.preferences.notifications.telegramUsername = body.telegramUsername.trim();
    if (typeof body.telegramChatId === 'string') user.preferences.notifications.telegramChatId = body.telegramChatId.trim();
    if (typeof body.telegramBotManagementEnabled === 'boolean') user.preferences.notifications.telegramBotManagementEnabled = body.telegramBotManagementEnabled;
    if (typeof body.prioritize0xdeadcode === 'boolean') {
      user.preferences.releaseGroups.prioritize0xdeadcode = body.prioritize0xdeadcode;
      user.preferences.releaseGroups.prefer0xdeadcodeForOnlineFixes = body.prioritize0xdeadcode;
    }
    if (typeof body.avoidRepacks === 'boolean') user.preferences.releaseGroups.avoidRepacks = body.avoidRepacks;
    if (typeof body.avoidOnlineFixes === 'boolean') {
      user.preferences.releaseGroups.avoidOnlineFixes = body.avoidOnlineFixes;
      if (body.avoidOnlineFixes) {
        user.preferences.releaseGroups.prioritize0xdeadcode = false;
        user.preferences.releaseGroups.prefer0xdeadcodeForOnlineFixes = false;
      }
    }
    if (typeof body.preferRepacks === 'boolean') user.preferences.releaseGroups.preferRepacks = body.preferRepacks;
    if (typeof body.showRecentUploads === 'boolean') user.preferences.homepage.showRecentUploads = body.showRecentUploads;

    await user.save();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PATCH /api/user/update error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
