import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import connectDB from '@/lib/db';
import { TrackedGame } from '@/lib/models';
import { searchSteamGames, buildSteamSearchQueryVariants, resolvePubTimestampFromBuild, resolvePubTimestampFromVersion, resolveLatestPubTimestamp } from '@/utils/steamApi';
import { analyzeGameTitle } from '@/utils/versionDetection';
import { getSteamBoxArt } from '@/utils/boxArt';

/**
 * POST /api/games/steam-verify
 * Search Steam API for game matches
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { gameId, query } = await request.json();

    if (!gameId || !query) {
      return NextResponse.json({ error: 'Game ID and search query are required' }, { status: 400 });
    }

    await connectDB();

    // Get the tracked game
    const trackedGame = await TrackedGame.findOne({ 
      _id: gameId,
      userId: user.id 
    });

    if (!trackedGame) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const queryVariants = buildSteamSearchQueryVariants(query);
    const mergedResults: Array<{
      appid: string;
      name: string;
      type: 'game' | 'dlc' | 'demo' | 'beta' | 'tool';
      developers?: string[];
      publishers?: string[];
      owners?: string;
      header_image?: string;
    }> = [];
    const seenAppIds = new Set<string>();

    for (const variant of queryVariants) {
      const searchResults = await searchSteamGames(variant, 10);
      for (const item of searchResults.results || []) {
        if (!item.appid || seenAppIds.has(item.appid)) continue;
        seenAppIds.add(item.appid);
        mergedResults.push(item);
      }
    }

    return NextResponse.json({
      success: true,
      results: mergedResults,
      query,
      queryVariants,
      total: mergedResults.length
    });

  } catch (error) {
    console.error('Steam verification search error:', error);
    return NextResponse.json({ 
      error: 'Failed to search Steam API',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * PATCH /api/games/steam-verify
 * Link a tracked game to a Steam app
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { gameId, steamAppId, steamName } = await request.json();

    if (!gameId || (!steamAppId && steamName !== null)) {
      return NextResponse.json({ error: 'Game ID and Steam app ID are required' }, { status: 400 });
    }

    await connectDB();

    // Update the tracked game with Steam verification
    const updateData: Record<string, string | boolean | null> = {
      steamVerified: true,
      steamAppId: steamAppId || null,
      steamName: steamName || null
    };

    const updatedGame = await TrackedGame.findOneAndUpdate(
      { _id: gameId, userId: user.id },
      updateData,
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // If no image exists and we have a Steam app ID, add Steam box art
    if (!updatedGame.image && steamAppId) {
      updatedGame.image = getSteamBoxArt(steamAppId);
      console.log(`🎨 Added Steam box art for ${updatedGame.title}: App ID ${steamAppId}`);
      await updatedGame.save();
    }

    // After manual Steam verification, perform semantic version and build detection
    if (updatedGame.title) {
      const versionAnalysis = analyzeGameTitle(updatedGame.title);
      
      // Update the game with detected version/build information if found
      const versionUpdateData: Record<string, string | boolean | Date> = {};
      
      if (versionAnalysis.hasVersionNumber && versionAnalysis.detectedVersion) {
        versionUpdateData.detectedVersion = versionAnalysis.detectedVersion;
        versionUpdateData.isDateVersion = versionAnalysis.isDateVersion || false;
        versionUpdateData.versionDetectionDate = new Date();
      }
      
      if (versionAnalysis.hasBuildNumber && versionAnalysis.detectedBuild) {
        versionUpdateData.detectedBuild = versionAnalysis.detectedBuild;
        versionUpdateData.isDateBasedBuild = versionAnalysis.isDateBasedBuild || false;
        versionUpdateData.buildDetectionDate = new Date();
      }
      
      // If we detected version/build info, update the game
      if (Object.keys(versionUpdateData).length > 0) {
        await TrackedGame.findByIdAndUpdate(updatedGame._id, versionUpdateData);
      }
    }

    // Backfill publication timestamp baseline for pubdate-first update comparisons.
    if (steamAppId) {
      try {
        let resolvedPubTs: number | null = null;

        if (updatedGame.currentBuildNumber) {
          resolvedPubTs = await resolvePubTimestampFromBuild(steamAppId, updatedGame.currentBuildNumber);
        }

        if (!resolvedPubTs && updatedGame.currentVersionNumber) {
          resolvedPubTs = await resolvePubTimestampFromVersion(steamAppId, updatedGame.currentVersionNumber);
        }

        if (!resolvedPubTs) {
          resolvedPubTs = await resolveLatestPubTimestamp(steamAppId);
        }

        if (typeof resolvedPubTs === 'number' && resolvedPubTs > 0) {
          updatedGame.lastPubTimestamp = resolvedPubTs;
          await updatedGame.save();
        }
      } catch (pubTsError) {
        console.warn('Failed to backfill pub timestamp after Steam verification:', pubTsError);
      }
    }

    return NextResponse.json({
      success: true,
      game: updatedGame
    });

  } catch (error) {
    console.error('Steam verification link error:', error);
    return NextResponse.json({ 
      error: 'Failed to link Steam game',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * DELETE /api/games/steam-verify
 * Remove Steam verification from a tracked game
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const gameId = url.searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json({ error: 'Game ID is required' }, { status: 400 });
    }

    await connectDB();

    // Remove Steam verification data
    const updatedGame = await TrackedGame.findOneAndUpdate(
      { _id: gameId, userId: user.id },
      {
        $unset: {
          steamAppId: 1,
          steamName: 1
        },
        steamVerified: false
      },
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      game: updatedGame
    });

  } catch (error) {
    console.error('Steam verification removal error:', error);
    return NextResponse.json({ 
      error: 'Failed to remove Steam verification',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}