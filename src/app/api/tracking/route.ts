import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { TrackedGame } from '../../../lib/models';
import { getCurrentUser } from '../../../lib/auth';
import { cleanGameTitle, decodeHtmlEntities } from '../../../utils/steamApi';
import { autoVerifyWithSteam } from '../../../utils/autoSteamVerification';
import { updateScheduler } from '../../../lib/scheduler';
import { analyzeGameTitle, extractReleaseGroup } from '../../../utils/versionDetection';
import { ReleaseGroupVariant } from '../../../lib/models';

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

    const { gameId, title, source, image, description, gameLink } = await request.json();

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
      title,
      source,
      image,
      description: decodeHtmlEntities(description || ''),
      gameLink,
      originalTitle: title,
      cleanedTitle: cleanGameTitle(title)
    });

    await trackedGame.save();

    // Attempt automatic Steam verification
    try {
      console.log(`🔍 Attempting auto Steam verification for newly added game: "${title}"`);
      
      // Try with original title first
      let autoVerification = await autoVerifyWithSteam(title, 0.85);
      
      // If original title fails, try with cleaned title
      if (!autoVerification.success) {
        const cleanedTitle = cleanGameTitle(title);
        if (cleanedTitle !== title.toLowerCase().trim()) {
          console.log(`🔄 Retrying auto Steam verification with cleaned title: "${cleanedTitle}"`);
          autoVerification = await autoVerifyWithSteam(cleanedTitle, 0.80); // Slightly lower threshold for cleaned title
        }
      }
      
      if (autoVerification.success && autoVerification.steamAppId && autoVerification.steamName) {
        // Update the game with Steam verification data
        trackedGame.steamVerified = true;
        trackedGame.steamAppId = autoVerification.steamAppId;
        trackedGame.steamName = autoVerification.steamName;
        await trackedGame.save();
        
        console.log(`✅ Auto Steam verification successful for "${title}": ${autoVerification.steamName} (${autoVerification.steamAppId})`);
      } else {
        console.log(`⚠️ Auto Steam verification failed for "${title}": ${autoVerification.reason}`);
      }
    } catch (verificationError) {
      console.error(`❌ Auto Steam verification error for "${title}":`, verificationError);
      // Don't fail the entire request if Steam verification fails
    }

    // Attempt automatic version detection and verification
    try {
      console.log(`🔍 Attempting auto version detection for newly added game: "${title}"`);
      
      const versionAnalysis = analyzeGameTitle(title);
      
      if (versionAnalysis.detectedVersion) {
        // Auto-verify the detected version
        trackedGame.currentVersionNumber = versionAnalysis.detectedVersion;
        trackedGame.versionNumberVerified = true;
        trackedGame.versionNumberSource = 'auto-detected';
        console.log(`✅ Auto-detected and verified version for "${title}": v${versionAnalysis.detectedVersion}`);
      }
      
      if (versionAnalysis.detectedBuild) {
        // Auto-verify the detected build number
        trackedGame.currentBuildNumber = versionAnalysis.detectedBuild;
        trackedGame.buildNumberVerified = true;
        trackedGame.buildNumberSource = 'auto-detected';
        console.log(`✅ Auto-detected and verified build for "${title}": Build #${versionAnalysis.detectedBuild}`);
      }
      
      // Save the version/build updates
      if (versionAnalysis.detectedVersion || versionAnalysis.detectedBuild) {
        await trackedGame.save();
      }
      
    } catch (versionError) {
      console.error(`❌ Auto version detection error for "${title}":`, versionError);
      // Don't fail the entire request if version detection fails
    }

    // Attempt to extract and store release group information
    try {
      console.log(`🔍 Attempting release group extraction for newly added game: "${title}"`);
      
      const releaseGroup = extractReleaseGroup(title);
      
      if (releaseGroup) {
        console.log(`✅ Detected release group: ${releaseGroup}`);
        
        // Check if this release group variant already exists for this game
        const existingVariant = await ReleaseGroupVariant.findOne({
          gameId: trackedGame._id,
          releaseGroup: releaseGroup
        });

        if (!existingVariant) {
          const variant = new ReleaseGroupVariant({
            gameId: trackedGame._id,
            releaseGroup: releaseGroup,
            title: title,
            version: trackedGame.currentVersionNumber || "",
            buildNumber: trackedGame.currentBuildNumber || "",
            detectedAt: new Date()
          });
          await variant.save();
          console.log(`✅ Stored release group variant: ${releaseGroup} for game "${title}"`);
        } else {
          console.log(`ℹ️ Release group variant ${releaseGroup} already exists for this game`);
        }
      } else {
        console.log(`ℹ️ No release group detected in title: "${title}"`);
      }
      
    } catch (releaseGroupError) {
      console.error(`❌ Release group extraction error for "${title}":`, releaseGroupError);
      // Don't fail the entire request if release group extraction fails
    }

    // Update user's scheduler after adding a game
    try {
      await updateScheduler.updateUserSchedule(user.id);
    } catch (schedulerError) {
      console.error('Failed to update scheduler:', schedulerError);
      // Don't fail the request if scheduler update fails
    }

    return NextResponse.json({
      message: 'Game added to tracking',
      game: trackedGame
    }, { status: 201 });

  } catch (error) {
    console.error('Add tracking error:', error);
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

    console.log(`🗑️ Successfully deleted tracked game: "${result.title}" (${gameId}) for user ${user.id}`);

    // Update user's scheduler after removing a game
    try {
      await updateScheduler.updateUserSchedule(user.id);
    } catch (schedulerError) {
      console.error('Failed to update scheduler:', schedulerError);
      // Don't fail the request if scheduler update fails
    }

    return NextResponse.json({
      message: 'Game removed from tracking',
      game: result
    });

  } catch (error) {
    console.error('Remove tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to remove game from tracking' },
      { status: 500 }
    );
  }
}