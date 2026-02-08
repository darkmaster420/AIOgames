import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth-options';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';
import { sendNotifications } from '../../../../utils/appriseNotifier';

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const user = await User.findById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const appriseUrls = user.preferences?.notifications?.appriseUrls || [];
    
    if (appriseUrls.length === 0) {
      return NextResponse.json({ 
        error: 'No notification services configured. Please add an Apprise URL in your settings.' 
      }, { status: 400 });
    }

    const payload = {
      title: 'Test Notification',
      body: 'This is a test notification from AIOgames. Your notification service is working correctly! 🎮'
    };

    const { results, sentCount, failedCount } = await sendNotifications(appriseUrls, payload);

    return NextResponse.json({ 
      message: `Sent ${sentCount} notification(s) successfully${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
      results 
    });
  } catch (error) {
    console.error('POST /api/notifications/send-test error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
