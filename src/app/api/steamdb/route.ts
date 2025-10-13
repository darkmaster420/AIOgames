import { NextRequest, NextResponse } from 'next/server';
import { checkSteamVerifiedGamesForUpdates, fetchSteamDBUpdates, SteamDBUpdate } from '../../../utils/steamdbMonitor';
import connectDB from '../../../lib/db';
import mongoose from 'mongoose';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'updates';
    const appId = searchParams.get('appId');
    const limit = parseInt(searchParams.get('limit') || '20');

    switch (action) {
      case 'updates':
        if (appId) {
          // Get updates for a specific Steam app
          const updates = await fetchSteamDBUpdates(appId);
          const res = NextResponse.json({
            success: true,
            data: {
              updates: updates.slice(0, limit),
              count: updates.length,
              appId,
              lastUpdated: new Date().toISOString(),
            }
          });
          // Cache this response for 30 minutes at the edge and allow revalidation
          res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=300');
          return res;
        } else {
          // Get updates for all Steam-verified games being tracked
          await connectDB();
          const db = mongoose.connection.db;
          const games = await db!.collection('games').find({
            steamAppId: { $exists: true, $ne: null }
          }).toArray();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const steamApps = games.map((game: any) => ({
            appId: game.steamAppId?.toString() || '',
            gameTitle: game.title || '',
            lastChecked: game.lastSteamCheck
          })).filter(app => app.appId && app.gameTitle);

          const result = await checkSteamVerifiedGamesForUpdates(steamApps);
          const res = NextResponse.json({
            success: true,
            data: {
              updates: result.updates.slice(0, limit),
              count: result.updates.length,
              lastChecked: result.lastChecked,
              checkedApps: steamApps.length,
            }
          });
          res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=120');
          return res;
        }

      case 'notifications':
        // Get all Steam-verified games and check for updates to create notifications
        await connectDB();
        const db = mongoose.connection.db;
        const trackedGames = await db!.collection('games').find({
          steamAppId: { $exists: true, $ne: null }
        }).toArray();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const steamAppsForNotifications = trackedGames.map((game: any) => ({
          appId: game.steamAppId?.toString() || '',
          gameTitle: game.title || '',
          lastChecked: game.lastSteamCheck
        })).filter(app => app.appId && app.gameTitle);

        const updateResult = await checkSteamVerifiedGamesForUpdates(steamAppsForNotifications);
        
        // Format as notifications
        const notifications = updateResult.updates.map((update: SteamDBUpdate) => ({
          gameTitle: update.gameTitle,
          category: update.version ? 'Update' : 'Patch',
          steamLink: update.link,
          appId: update.appId,
          message: `${update.gameTitle} has a new update! Consider searching for it.`,
          version: update.version,
          changeNumber: update.changeNumber,
          date: update.date,
        }));

        const res = NextResponse.json({
          success: true,
          data: {
            notifications: notifications.slice(0, limit),
            updates: updateResult.updates.slice(0, limit),
            count: notifications.length,
            lastChecked: updateResult.lastChecked,
          }
        });
        res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=120');
        return res;

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action parameter. Use "updates" or "notifications"' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('SteamDB API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch SteamDB updates'
      },
      { status: 500 }
    );
  }
}