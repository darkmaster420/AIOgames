import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// POST: Check for build number updates for verified games
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();

    // Find all games with build number verification for this user
    const verifiedGames = await TrackedGame.find({
      userId: user.id,
      isActive: true,
      buildNumberVerified: true,
      currentBuildNumber: { $exists: true, $ne: '' }
    }).select('_id gameId title currentBuildNumber steamAppId');

    if (verifiedGames.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No games with build number verification found',
        checkedCount: 0,
        results: {}
      });
    }

    console.log(`🔢 Checking build numbers for ${verifiedGames.length} verified games`);

    const results: Record<string, {
      currentBuildNumber: string;
      hasUpdate?: boolean;
      latestBuildNumber?: string;
      message: string;
      status: 'success' | 'info' | 'error';
    }> = {};

    // For now, we'll just return the current status since we can't automatically check SteamDB
    // Users would need to manually update the build numbers when they see updates
    for (const game of verifiedGames) {
      results[game.gameId] = {
        currentBuildNumber: game.currentBuildNumber,
        message: `Current build: ${game.currentBuildNumber}. Check SteamDB manually for updates.`,
        status: 'info'
      };

      if (game.steamAppId) {
        results[game.gameId].message += ` Visit steamdb.info/app/${game.steamAppId}/patchnotes/`;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Checked ${verifiedGames.length} games with build number verification`,
      checkedCount: verifiedGames.length,
      results,
      note: 'Build numbers need to be updated manually. Check SteamDB for the latest versions.'
    });

  } catch (error) {
    console.error('Error checking build number updates:', error);
    return NextResponse.json(
      { error: 'Failed to check build number updates' },
      { status: 500 }
    );
  }
}

// GET: Get build number status for user's games
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get summary statistics
    const totalGames = await TrackedGame.countDocuments({
      userId: user.id,
      isActive: true
    });

    const verifiedGames = await TrackedGame.countDocuments({
      userId: user.id,
      isActive: true,
      buildNumberVerified: true
    });

    const steamVerifiedGames = await TrackedGame.countDocuments({
      userId: user.id,
      isActive: true,
      steamVerified: true
    });

    const bothVerifiedGames = await TrackedGame.countDocuments({
      userId: user.id,
      isActive: true,
      steamVerified: true,
      buildNumberVerified: true
    });

    // Get recent build number verifications
    const recentVerifications = await TrackedGame.find({
      userId: user.id,
      isActive: true,
      buildNumberVerified: true,
      buildNumberLastUpdated: { $exists: true }
    })
    .select('title currentBuildNumber buildNumberLastUpdated steamAppId')
    .sort({ buildNumberLastUpdated: -1 })
    .limit(5);

    return NextResponse.json({
      success: true,
      summary: {
        totalGames,
        steamVerifiedGames,
        buildNumberVerifiedGames: verifiedGames,
        bothVerifiedGames,
        verificationRate: totalGames > 0 ? Math.round((verifiedGames / totalGames) * 100) : 0
      },
      recentVerifications: recentVerifications.map(game => ({
        title: game.title,
        buildNumber: game.currentBuildNumber,
        lastUpdated: game.buildNumberLastUpdated,
        steamAppId: game.steamAppId
      }))
    });

  } catch (error) {
    console.error('Error fetching build number status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch build number status' },
      { status: 500 }
    );
  }
}