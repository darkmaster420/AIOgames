import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { TrackedGame } from '../../../lib/models';

// Simple notification system - could be extended for email, Discord, etc.
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const { gameId, updateInfo } = await request.json();

    if (!gameId || !updateInfo) {
      return NextResponse.json(
        { error: 'gameId and updateInfo are required' },
        { status: 400 }
      );
    }

    // Find the tracked game
    const game = await TrackedGame.findOne({ gameId, isActive: true });
    
    if (!game) {
      return NextResponse.json(
        { error: 'Game not found or not tracked' },
        { status: 404 }
      );
    }

    // For now, just log the notification
    console.log(`🎮 Game Update Notification:`);
    console.log(`  Game: ${game.title}`);
    console.log(`  New Version: ${updateInfo.version}`);
    console.log(`  Date Found: ${updateInfo.dateFound}`);
    console.log(`  Link: ${updateInfo.gameLink}`);

    // TODO: Implement actual notifications here
    // - Email notifications
    // - Discord webhooks
    // - Push notifications
    // - RSS feeds

    return NextResponse.json({
      message: 'Notification processed',
      game: game.title,
      update: updateInfo
    });

  } catch (error) {
    console.error('Notification error:', error);
    return NextResponse.json(
      { error: 'Failed to process notification' },
      { status: 500 }
    );
  }
}

// Get notification history/stats
export async function GET() {
  try {
    await connectDB();

    // Get games with recent updates
    const recentUpdates = await TrackedGame.find({
      'updateHistory.0': { $exists: true },
      isActive: true
    })
    .sort({ 'updateHistory.dateFound': -1 })
    .limit(20)
    .select('title updateHistory');

    const notifications = recentUpdates.map((game: { title: string; updateHistory: { version: string; dateFound: string }[] }) => ({
      gameTitle: game.title,
      latestUpdate: game.updateHistory[game.updateHistory.length - 1],
      totalUpdates: game.updateHistory.length
    }));

    return NextResponse.json({
      totalNotifications: notifications.length,
      recentNotifications: notifications
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    return NextResponse.json(
      { error: 'Failed to get notifications' },
      { status: 500 }
    );
  }
}