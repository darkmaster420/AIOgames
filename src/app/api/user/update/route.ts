import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';
import bcrypt from 'bcryptjs';

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

  const body = await req.json();
  const { 
    email, 
    username,
    currentPassword, 
    newPassword, 
    provider, 
    webpushEnabled,
    notifyImmediately,
    telegramEnabled, 
    telegramBotToken, 
    telegramChatId,
    telegramBotManagementEnabled,
    prioritize0xdeadcode,
    prefer0xdeadcodeForOnlineFixes
  } = body;

    await connectDB();

    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Update email if provided and different
    if (email && email !== user.email) {
      // ensure uniqueness
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists) {
        return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
      }
      user.email = email.toLowerCase();
    }

    // Update username if provided and different (unlimited changes allowed)
    if (typeof username === 'string' && username.toLowerCase() !== (user.username || '')) {
      const normalized = username.toLowerCase().trim();
      if (normalized.length < 3 || normalized.length > 24) {
        return NextResponse.json({ error: 'Username must be 3-24 characters' }, { status: 400 });
      }
      if (!/^[a-z0-9_]+$/.test(normalized)) {
        return NextResponse.json({ error: 'Username can only contain lowercase letters, numbers, and underscores' }, { status: 400 });
      }
      // Exclude current user from uniqueness check
      const existsUsername = await User.findOne({ username: normalized, _id: { $ne: user._id } });
      if (existsUsername) {
        return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
      }
      user.username = normalized;
    }

    // Handle password change
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: 'Current password required to change password' }, { status: 400 });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
      }

      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      user.password = hashed;
    }

    // Update notification preferences if provided
    if (typeof provider === 'string') {
      user.preferences = user.preferences || {};
      user.preferences.notifications = user.preferences.notifications || {};
      user.preferences.notifications.provider = provider;
    }

    if (typeof webpushEnabled === 'boolean') {
      user.preferences = user.preferences || {};
      user.preferences.notifications = user.preferences.notifications || {};
      user.preferences.notifications.webpushEnabled = webpushEnabled;
    }

    // Update immediate notifications setting
    if (typeof notifyImmediately === 'boolean') {
      user.preferences = user.preferences || {};
      user.preferences.notifications = user.preferences.notifications || {};
      user.preferences.notifications.notifyImmediately = notifyImmediately;
    }

    // Update Telegram notification settings
    if (typeof telegramEnabled === 'boolean') {
      user.preferences = user.preferences || {};
      user.preferences.notifications = user.preferences.notifications || {};
      user.preferences.notifications.telegramEnabled = telegramEnabled;
    }

    if (typeof telegramBotToken === 'string') {
      user.preferences = user.preferences || {};
      user.preferences.notifications = user.preferences.notifications || {};
      user.preferences.notifications.telegramBotToken = telegramBotToken;
    }

    if (typeof telegramChatId === 'string') {
      user.preferences = user.preferences || {};
      user.preferences.notifications = user.preferences.notifications || {};
      user.preferences.notifications.telegramChatId = telegramChatId;
    }

    if (typeof telegramBotManagementEnabled === 'boolean') {
      user.preferences = user.preferences || {};
      user.preferences.notifications = user.preferences.notifications || {};
      user.preferences.notifications.telegramBotManagementEnabled = telegramBotManagementEnabled;
    }

    // Update release group preferences
    if (typeof prioritize0xdeadcode === 'boolean') {
      user.preferences = user.preferences || {};
      user.preferences.releaseGroups = user.preferences.releaseGroups || {};
      user.preferences.releaseGroups.prioritize0xdeadcode = prioritize0xdeadcode;
    }

    if (typeof prefer0xdeadcodeForOnlineFixes === 'boolean') {
      user.preferences = user.preferences || {};
      user.preferences.releaseGroups = user.preferences.releaseGroups || {};
      user.preferences.releaseGroups.prefer0xdeadcodeForOnlineFixes = prefer0xdeadcodeForOnlineFixes;
    }

    await user.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PATCH /api/user/update error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
