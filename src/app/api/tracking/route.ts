import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { TrackedGame } from '../../../lib/models';
import { getCurrentUser } from '../../../lib/auth';
import { cleanGameTitle, decodeHtmlEntities, resolveBuildFromVersion, resolveVersionFromBuild } from '../../../utils/steamApi';
import logger from '../../../utils/logger';
import { autoVerifyWithSteam } from '../../../utils/autoSteamVerification';
import { updateScheduler } from '../../../lib/scheduler';
import { analyzeGameTitle } from '../../../utils/versionDetection';

// GET - Fetch all tracked games for the current user
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
    
    const trackedGames = await TrackedGame.find({ 
      userId: user.id,
      isActive: true 
    })
    .select('gameId title originalTitle source image description gameLink lastKnownVersion steamAppId steamName steamVerified buildNumberVerified currentBuildNumber buildNumberSource versionNumberVerified currentVersionNumber versionNumberSource lastVersionDate dateAdded lastChecked notificationsEnabled checkFrequency updateHistory pendingUpdates isActive')
    .sort({ dateAdded: -1 });
    
    return NextResponse.json({
      games: trackedGames
    });

  } catch (error) {
    console.error('Get tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tracked games' },
      { status: 500 }
    );
  }
}

// POST - Add a new game to tracking
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId, title, originalTitle, cleanedTitle, source, image, description, gameLink } = await request.json();

    if (!gameId || !title || !source || !gameLink) {
      return NextResponse.json(
        { error: 'gameId, title, source, and gameLink are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if game is already tracked by this user (only active games)
    const existingGame = await TrackedGame.findOne({ 
      userId: user.id,
      gameId,
      isActive: true
    });

    if (existingGame) {
      return NextResponse.json(
        { error: 'Game is already being tracked' },
        { status: 400 }
      );
    }

    // Create new tracked game
    const trackedGame = new TrackedGame({
      userId: user.id,
      gameId,
      title: cleanedTitle || cleanGameTitle(title), // Use provided cleaned title or clean the title
      source,
      image,
      description: decodeHtmlEntities(description || ''),
      gameLink,
      originalTitle: originalTitle || title, // Use original title for Steam verification and advanced view
      cleanedTitle: cleanedTitle || cleanGameTitle(title) // Ensure we have a cleaned title
    });

    await trackedGame.save();

    // Attempt automatic Steam verification
    try {
  logger.info(`Auto Steam verification for newly added game: "${originalTitle || title}"`);
      
      // Try with original title first (best for Steam matching)
      const titleForSteam = originalTitle || title;
      let autoVerification = await autoVerifyWithSteam(titleForSteam, 0.85);
      
      // If original title fails, try with cleaned title
      if (!autoVerification.success) {
        const cleanedTitleForSteam = cleanedTitle || cleanGameTitle(title);
        if (cleanedTitleForSteam !== titleForSteam.toLowerCase().trim()) {
          logger.debug(`Retry auto Steam verification with cleaned title: "${cleanedTitleForSteam}"`);
          autoVerification = await autoVerifyWithSteam(cleanedTitleForSteam, 0.80); // Slightly lower threshold for cleaned title
        }
      }
      
      if (autoVerification.success && autoVerification.steamAppId && autoVerification.steamName) {
        // Update the game with Steam verification data
        trackedGame.steamVerified = true;
        trackedGame.steamAppId = autoVerification.steamAppId;
        trackedGame.steamName = autoVerification.steamName;
        await trackedGame.save();
        
  logger.info(`Auto Steam verification successful for "${title}": ${autoVerification.steamName} (${autoVerification.steamAppId})`);
      } else {
  logger.warn(`Auto Steam verification failed for "${title}": ${autoVerification.reason}`);
      }
    } catch (verificationError) {
  logger.error(`Auto Steam verification error for "${title}":`, verificationError);
      // Don't fail the entire request if Steam verification fails
    }

    // Attempt automatic version detection and verification (and resolve via SteamDB)
    try {
  logger.debug(`Attempting auto version detection for newly added game: "${title}"`);
      
      const versionAnalysis = analyzeGameTitle(title);
      
      if (versionAnalysis.detectedVersion) {
        // Auto-verify the detected version
        trackedGame.currentVersionNumber = versionAnalysis.detectedVersion;
        trackedGame.versionNumberVerified = true;
        trackedGame.versionNumberSource = 'auto-detected';
  logger.info(`Auto-detected and verified version for "${title}": v${versionAnalysis.detectedVersion}`);
      }
      
      if (versionAnalysis.detectedBuild) {
        // Auto-verify the detected build number
        trackedGame.currentBuildNumber = versionAnalysis.detectedBuild;
        trackedGame.buildNumberVerified = true;
        trackedGame.buildNumberSource = 'auto-detected';
  logger.info(`Auto-detected and verified build for "${title}": Build #${versionAnalysis.detectedBuild}`);
      }

      // If we have a Steam App ID and only one side, try to resolve the other via SteamDB
      if (trackedGame.steamAppId) {
        try {
          if (trackedGame.currentVersionNumber && !trackedGame.currentBuildNumber) {
            const build = await resolveBuildFromVersion(trackedGame.steamAppId, trackedGame.currentVersionNumber);
            if (build) {
              trackedGame.currentBuildNumber = build;
              trackedGame.buildNumberVerified = true;
              trackedGame.buildNumberSource = 'steamdb:auto';
              logger.info(`Resolved build ${build} from version ${trackedGame.currentVersionNumber} via SteamDB`);
            }
          } else if (!trackedGame.currentVersionNumber && trackedGame.currentBuildNumber) {
            const version = await resolveVersionFromBuild(trackedGame.steamAppId, trackedGame.currentBuildNumber);
            if (version) {
              trackedGame.currentVersionNumber = version;
              trackedGame.versionNumberVerified = true;
              trackedGame.versionNumberSource = 'steamdb:auto';
              logger.info(`Resolved version ${version} from build ${trackedGame.currentBuildNumber} via SteamDB`);
            }
          }
        } catch (e) {
          logger.debug('SteamDB resolution skipped:', e instanceof Error ? e.message : 'unknown');
        }
      }
      
      // Compose a friendly lastKnownVersion for UI if any verified value exists
      const hasVersion = !!trackedGame.currentVersionNumber;
      const hasBuild = !!trackedGame.currentBuildNumber;
      if (hasVersion || hasBuild) {
        const versionLabel = hasVersion ? trackedGame.currentVersionNumber : '';
        const buildLabel = hasBuild ? `Build ${trackedGame.currentBuildNumber}` : '';
        trackedGame.lastKnownVersion = [versionLabel, buildLabel].filter(Boolean).join(' · ');
      }

      // Save the updates
      await trackedGame.save();
      
    } catch (versionError) {
  logger.error(`Auto version detection error for "${title}":`, versionError);
      // Don't fail the entire request if version detection fails
    }

    // Update user's scheduler after adding a game
    try {
      await updateScheduler.updateUserSchedule(user.id);
    } catch (schedulerError) {
  logger.error('Failed to update scheduler:', schedulerError);
      // Don't fail the request if scheduler update fails
    }

    return NextResponse.json({
      message: 'Game added to tracking',
      game: trackedGame
    }, { status: 201 });

  } catch (error) {
  logger.error('Add tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to add game to tracking' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a game from tracking
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json(
        { error: 'gameId is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Actually delete the tracked game instead of just marking as inactive
    const result = await TrackedGame.findOneAndDelete({
      userId: user.id, 
      gameId
    });

    if (!result) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

  logger.info(`Deleted tracked game: "${result.title}" (${gameId}) for user ${user.id}`);

    // Update user's scheduler after removing a game
    try {
      await updateScheduler.updateUserSchedule(user.id);
    } catch (schedulerError) {
  logger.error('Failed to update scheduler:', schedulerError);
      // Don't fail the request if scheduler update fails
    }

    return NextResponse.json({
      message: 'Game removed from tracking',
      game: result
    });

  } catch (error) {
  logger.error('Remove tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to remove game from tracking' },
      { status: 500 }
    );
  }
}