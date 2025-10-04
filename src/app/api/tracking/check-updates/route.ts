import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';

export async function POST(request: NextRequest) {
  try {
    // Check for session or user ID header for Telegram bot requests
    const session = await getServerSession(authOptions);
    const userIdHeader = request.headers.get('X-User-ID');
    
    let userId = session?.user?.id;
    
    // If no session but user ID header is present (for Telegram bot), use that
    if (!userId && userIdHeader) {
      userId = userIdHeader;
    }
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    
    // Get user's tracked games
    const trackedGames = await TrackedGame.find({ 
      userId: userId,
      isActive: true 
    });

    if (trackedGames.length === 0) {
      return NextResponse.json({ 
        message: 'No games being tracked',
        updatesFound: 0,
        totalChecked: 0 
      });
    }

    let updatesFound = 0;
    const totalChecked = trackedGames.length;

    // For now, we'll simulate update checking
    // In a real implementation, you would:
    // 1. Fetch the latest version of each game from the source
    // 2. Compare with stored version
    // 3. Update the database if newer version found
    // 4. Mark as having new update if applicable

    // Simulate some games having updates (for demo purposes)
    for (const game of trackedGames) {
      // Random chance of finding an update (replace with real logic)
      const hasUpdate = Math.random() < 0.1; // 10% chance
      
      if (hasUpdate && !game.hasNewUpdate) {
        game.hasNewUpdate = true;
        game.newUpdateSeen = false;
        game.lastChecked = new Date();
        await game.save();
        updatesFound++;
      } else {
        // Update last checked time
        game.lastChecked = new Date();
        await game.save();
      }
    }

    return NextResponse.json({
      message: `Checked ${totalChecked} games, found ${updatesFound} updates`,
      updatesFound,
      totalChecked,
      success: true
    });

  } catch (error) {
    console.error('Update check error:', error);
    return NextResponse.json({ error: 'Failed to check for updates' }, { status: 500 });
  }
}