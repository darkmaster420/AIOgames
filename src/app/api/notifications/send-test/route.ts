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
      console.log('[WebPush Test] No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[WebPush Test] Starting test for user:', session.user.id);

    // VAPID keys are configured by configureWebPush() above
    await connectDB();
    const user = await User.findById(session.user.id);
    if (!user) {
      console.log('[WebPush Test] User not found in database:', session.user.id);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const subs = user.pushSubscriptions || [];
    console.log(`[WebPush Test] Found ${subs.length} push subscriptions`);
    
    if (subs.length === 0) {
      return NextResponse.json({ 
        error: 'No push subscriptions found', 
        message: 'Please enable notifications first' 
      }, { status: 400 });
    }

    const payload = JSON.stringify({ 
      title: 'Test notification', 
      body: 'This is a test push notification from AIOgames.',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png'
    });

    console.log('[WebPush Test] Payload:', payload);

    const results = [];
    for (const sub of subs) {
      try {
        console.log('[WebPush Test] Sending to endpoint:', sub.endpoint.substring(0, 50) + '...');
        await webpush.sendNotification(sub, payload);
        console.log('[WebPush Test] ✓ Successfully sent to endpoint');
        results.push({ endpoint: sub.endpoint, success: true });
      } catch (e) {
        console.error('[WebPush Test] ✗ Push send error for', sub.endpoint, e);
        results.push({ endpoint: sub.endpoint, success: false, error: String(e) });
      }
    }

    console.log('[WebPush Test] Results:', JSON.stringify(results, null, 2));
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[WebPush Test] POST /api/notifications/send-test error', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
