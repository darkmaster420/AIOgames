import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { User } from '@/lib/models';
import connectDB from '@/lib/db';
import { testAppriseUrl } from '@/utils/appriseNotifier';

/**
 * GET: Get user's Apprise URLs
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const dbUser = await User.findById(user.id);
    
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      appriseUrls: dbUser.preferences?.notifications?.appriseUrls || []
    });
  } catch (error) {
    console.error('Error fetching Apprise URLs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Apprise URLs' },
      { status: 500 }
    );
  }
}

/**
 * POST: Add or test an Apprise URL
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Test the URL
    if (action === 'test') {
      const result = await testAppriseUrl(url);
      return NextResponse.json({
        success: result.success,
        service: result.service,
        error: result.error
      });
    }

    // Add URL to user's configuration
    if (action === 'add') {
      await connectDB();
      const dbUser = await User.findById(user.id);
      
      if (!dbUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Initialize if needed
      if (!dbUser.preferences) {
        dbUser.preferences = {};
      }
      if (!dbUser.preferences.notifications) {
        dbUser.preferences.notifications = {};
      }
      if (!dbUser.preferences.notifications.appriseUrls) {
        dbUser.preferences.notifications.appriseUrls = [];
      }

      // Check if URL already exists
      if (dbUser.preferences.notifications.appriseUrls.includes(url)) {
        return NextResponse.json({
          success: false,
          error: 'URL already exists'
        }, { status: 400 });
      }

      // Add URL
      dbUser.preferences.notifications.appriseUrls.push(url);
      await dbUser.save();

      return NextResponse.json({
        success: true,
        appriseUrls: dbUser.preferences.notifications.appriseUrls
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error managing Apprise URL:', error);
    return NextResponse.json(
      { error: 'Failed to manage Apprise URL' },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Remove an Apprise URL
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    await connectDB();
    const dbUser = await User.findById(user.id);
    
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Remove URL
    if (dbUser.preferences?.notifications?.appriseUrls) {
      dbUser.preferences.notifications.appriseUrls = 
        dbUser.preferences.notifications.appriseUrls.filter((u: string) => u !== url);
      await dbUser.save();
    }

    return NextResponse.json({
      success: true,
      appriseUrls: dbUser.preferences?.notifications?.appriseUrls || []
    });
  } catch (error) {
    console.error('Error removing Apprise URL:', error);
    return NextResponse.json(
      { error: 'Failed to remove Apprise URL' },
      { status: 500 }
    );
  }
}
