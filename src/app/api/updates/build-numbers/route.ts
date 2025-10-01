import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { getSteamAppDetails } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';

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

  logger.info(`Checking build numbers for ${verifiedGames.length} verified games`);

    const results: Record<string, {
      currentBuildNumber: string;
      hasUpdate?: boolean;
      latestBuildNumber?: string;
      latestPublishedAt?: string | null;
      message: string;
      status: 'success' | 'info' | 'error';
    }> = {};

    // Helper to process a single game with Steam API Worker
    const processGame = async (game: typeof verifiedGames[number]) => {
      try {
        const gameId = game.gameId as unknown as string;
        const currentBuild = parseInt(game.currentBuildNumber, 10);
        if (!game.steamAppId) {
          results[gameId] = {
            currentBuildNumber: game.currentBuildNumber,
            message: `Current build: ${game.currentBuildNumber}. Missing Steam App ID, cannot auto-check.`,
            status: 'info'
          };
          return;
        }

        // Fetch aggregated details (includes SteamDB builds)
        const details = await getSteamAppDetails(game.steamAppId);
        const latest = details.latest_build || (details.builds && details.builds[0]) || null;

        if (!latest || !latest.build_id) {
          results[gameId] = {
            currentBuildNumber: game.currentBuildNumber,
            message: `Current build: ${game.currentBuildNumber}. No SteamDB builds found via API.`,
            status: 'info'
          };
          return;
        }

        const latestBuild = parseInt(latest.build_id, 10);
        if (Number.isNaN(currentBuild) || Number.isNaN(latestBuild)) {
          results[gameId] = {
            currentBuildNumber: game.currentBuildNumber,
            latestBuildNumber: latest.build_id,
            latestPublishedAt: latest.published_at || null,
            message: `Could not compare builds (current="${game.currentBuildNumber}", latest="${latest.build_id}").`,
            status: 'error'
          };
          return;
        }

        const hasUpdate = latestBuild > currentBuild;
        results[gameId] = {
          currentBuildNumber: game.currentBuildNumber,
          latestBuildNumber: String(latestBuild),
          latestPublishedAt: latest.published_at || null,
          hasUpdate,
          message: hasUpdate
            ? `Update available: ${currentBuild} → ${latestBuild}${latest.published_at ? ` (published ${latest.published_at})` : ''}`
            : `Up-to-date: ${currentBuild}${latest.published_at ? ` (latest published ${latest.published_at})` : ''}`,
          status: hasUpdate ? 'success' : 'info'
        };
      } catch (e) {
        const gameId = game.gameId as unknown as string;
        results[gameId] = {
          currentBuildNumber: game.currentBuildNumber,
          message: `Failed to check SteamDB builds: ${(e as Error).message}`,
          status: 'error'
        };
      }
    };

    // Process with modest concurrency to avoid overloading the Worker
    const concurrency = 5;
    let index = 0;
    while (index < verifiedGames.length) {
      const slice = verifiedGames.slice(index, index + concurrency);
      await Promise.all(slice.map(processGame));
      index += concurrency;
    }

    return NextResponse.json({
      success: true,
      message: `Checked ${verifiedGames.length} games with build number verification via SteamDB`,
      checkedCount: verifiedGames.length,
      results
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