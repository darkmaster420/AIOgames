import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// GET: Get recent updates for the current user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    // Calculate the date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get games with approved updates (latestApprovedUpdate field) from the last 7 days
    const gamesWithUpdates = await TrackedGame.find({
      userId: user.id,
      isActive: true,
      latestApprovedUpdate: { $exists: true, $ne: null }, // Has an approved update
      'latestApprovedUpdate.dateFound': { $gte: sevenDaysAgo }, // Updated within the last 7 days
      updateHistory: { $exists: true, $ne: [] } // Has update history (ensures at least one actual update)
    })
      .select('title originalTitle steamName steamVerified image source gameId lastKnownVersion currentVersionNumber currentBuildNumber updateHistory latestApprovedUpdate')
      .sort({ 'latestApprovedUpdate.dateFound': -1 }) // Sort by most recent approved update
      .lean();

    // Deduplicate by gameId - keep only the most recent tracking entry for each unique game
    const seenGameIds = new Set<string>();
    const uniqueGames = gamesWithUpdates.filter(game => {
      if (seenGameIds.has(game.gameId)) {
        return false; // Skip duplicate
      }
      seenGameIds.add(game.gameId);
      return true;
    });

    // Transform the data to match the expected format
    const formattedGames = uniqueGames
      .slice(0, 50) // Limit to 50 after deduplication
      .map(game => {
        // Get the 5 most recent updates from history
        const recentHistory = (game.updateHistory || [])
          .sort((a: { dateFound: Date | string }, b: { dateFound: Date | string }) => 
            new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime()
          )
          .slice(0, 5);

        return {
          _id: game._id,
          title: game.title,
          originalTitle: game.originalTitle,
          steamName: game.steamName,
          steamVerified: game.steamVerified,
          image: game.image,
          source: game.source,
          currentVersion: game.latestApprovedUpdate?.version || game.lastKnownVersion,
          lastVersionDate: game.latestApprovedUpdate?.dateFound,
          updateHistory: recentHistory,
          totalUpdates: game.updateHistory?.length || 0
        };
      });

    return NextResponse.json({
      games: formattedGames
    });
  } catch (error) {
    console.error('Get recent updates error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent updates' },
      { status: 500 }
    );
  }
}