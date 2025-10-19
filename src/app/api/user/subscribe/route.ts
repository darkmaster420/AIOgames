import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth-options';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const subscription = body.subscription;
    if (!subscription || !subscription.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    await connectDB();
    const user = await User.findById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Avoid duplicates by endpoint
    user.pushSubscriptions = user.pushSubscriptions || [];
  const exists = user.pushSubscriptions.some((s: { endpoint?: string }) => s.endpoint === subscription.endpoint);
    if (!exists) {
      user.pushSubscriptions.push(subscription);
      await user.save();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/user/subscribe error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
