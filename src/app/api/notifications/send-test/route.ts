import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth-options';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';
import webpush from 'web-push';
import { configureWebPush } from '../../../../utils/vapidKeys';

// Ensure VAPID keys are configured
configureWebPush();

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // VAPID keys are configured by configureWebPush() above
    await connectDB();
    const user = await User.findById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const subs = user.pushSubscriptions || [];
    const payload = JSON.stringify({ title: 'Test notification', body: 'This is a test push notification from AIOgames.' });

    const results = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload);
        results.push({ endpoint: sub.endpoint, success: true });
      } catch (e) {
        console.error('Push send error for', sub.endpoint, e);
        results.push({ endpoint: sub.endpoint, success: false, error: String(e) });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('POST /api/notifications/send-test error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
