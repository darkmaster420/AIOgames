import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { TrackedGame } from '../../../lib/models';
import { getCurrentUser } from '../../../lib/auth';
import { cleanGameTitle, decodeHtmlEntities, resolveBuildFromVersion, resolveVersionFromBuild, resolveVersionFromDate, resolveComparableVersionData, calculateGamePriority, detectAndResolveGameConflicts, resolvePubTimestampFromBuild, resolveLatestPubTimestamp } from '../../../utils/steamApi';
import logger from '../../../utils/logger';
import { autoVerifyWithSteam } from '../../../utils/autoSteamVerification';
import { resolveIGDBImage } from '../../../utils/igdb';
import { updateScheduler } from '../../../lib/scheduler';
import { analyzeGameTitle } from '../../../utils/versionDetection';
import { searchGOGDBIndex, getLatestGOGVersion, initializeGOGDB } from '../../../utils/gogdbIndex';

/**
 * Compare two version strings (e.g., "1.2.3" vs "1.3.0")
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersionStrings(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(p => parseInt(p.replace(/[^\d]/g, '')) || 0);
  const parts2 = v2.split('.').map(p => parseInt(p.replace(/[^\d]/g, '')) || 0);
  
  const maxLength = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  
  return 0;
}

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
    .select('gameId title originalTitle cleanedTitle priority source image description gameLink lastKnownVersion steamAppId steamName steamVerified gogVerified gogProductId gogName gogVersion gogBuildId gogLastChecked buildNumberVerified currentBuildNumber buildNumberSource versionNumberVerified currentVersionNumber versionNumberSource lastVersionDate dateAdded lastChecked notificationsEnabled checkFrequency updateHistory isActive')
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

    const {
      gameId,
      title,
      originalTitle,
      cleanedTitle,
      steamAppId,
      source,
      image,
      description,
      gameLink,
      forceReplace
    } = await request.json();

    if (!gameId || !title || !source || !gameLink) {
      return NextResponse.json(
        { error: 'gameId, title, source, and gameLink are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Get user preferences for priority calculation
    const { User } = await import('../../../lib/models');
    const fullUser = await User.findById(user.id);
    const preferRepacks = fullUser?.preferences?.releaseGroups?.preferRepacks || false;

    // Check for potential conflicts with existing tracked games (sequels/variants)
    // Get all active tracked games for this user
    const allTrackedGames = await TrackedGame.find({ 
      userId: user.id,
      isActive: true 
    }).select('title originalTitle steamAppId cleanedTitle gameId');
    
    // Detect conflicts with related game titles (e.g., "Assetto Corsa" vs "Assetto Corsa Evo")
    const conflictCheck = await detectAndResolveGameConflicts(
      originalTitle || title,
      allTrackedGames.map(g => ({
        title: g.originalTitle || g.title,
        steamAppId: g.steamAppId,
        cleanedTitle: g.cleanedTitle
      }))
    );
    
    if (conflictCheck.hasConflict && conflictCheck.conflictingGame) {
      logger.warn(`❌ Potential sequel/variant conflict detected for "${title}"`);
      logger.warn(`   Conflicts with: "${conflictCheck.conflictingGame.title}"`);
      
      return NextResponse.json(
        { 
          error: `This game may be related to "${conflictCheck.conflictingGame.title}" that you're already tracking. Please verify they are different games.`,
          conflictingGame: conflictCheck.conflictingGame.title,
          suggestion: 'If these are different games (e.g., sequel or different edition), they need unique Steam App IDs to be tracked separately.'
        },
        { status: 409 }
      );
    }
    
    // If Steam differentiation was successful, store the Steam info
    const providedSteamAppId = (() => {
      const v = String(steamAppId || '').trim();
      return /^\d+$/.test(v) ? v : undefined;
    })();

    const autoSteamAppId: string | undefined = conflictCheck.resolvedSteamAppId || providedSteamAppId;
    const autoSteamName: string | undefined = conflictCheck.resolvedSteamName;
    
    if (autoSteamAppId) {
      logger.info(`✅ Steam differentiation successful for "${title}"`);
      logger.info(`   Steam App ID: ${autoSteamAppId}${autoSteamName ? ` - ${autoSteamName}` : ''}`);
    }

    const normalizedCleanedTitle = cleanedTitle || cleanGameTitle(title);

    const existingGame = await TrackedGame.findOne({
      userId: user.id,
      gameId,
      isActive: true
    });

    const existingTitleMatch = existingGame ? null : await TrackedGame.findOne({
      userId: user.id,
      cleanedTitle: normalizedCleanedTitle,
      isActive: true
    });

    const replacementTarget = existingGame || existingTitleMatch;

    if (replacementTarget) {
      const newTitleAnalysis = analyzeGameTitle(title);
      const existingTitleAnalysis = analyzeGameTitle(replacementTarget.originalTitle || replacementTarget.title);

      let newVersion = newTitleAnalysis.detectedVersion || '';
      let existingVersion = existingTitleAnalysis.detectedVersion || replacementTarget.currentVersionNumber || '';
      let newBuild = newTitleAnalysis.detectedBuild || '';
      let existingBuild = existingTitleAnalysis.detectedBuild || replacementTarget.currentBuildNumber || '';

      if (replacementTarget.steamAppId) {
        const existingComparable = await resolveComparableVersionData(replacementTarget.steamAppId, {
          version: existingVersion,
          build: existingBuild,
          isDateVersion: replacementTarget.isDateVersion,
        });
        existingVersion = existingComparable.version || existingVersion;
        existingBuild = existingComparable.build || existingBuild;

        const newComparable = await resolveComparableVersionData(replacementTarget.steamAppId, {
          version: newVersion,
          build: newBuild,
          isDateVersion: /^\d{8}$/.test(newVersion) || /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(newVersion),
        });
        newVersion = newComparable.version || newVersion;
        newBuild = newComparable.build || newBuild;
      }

      logger.info(`Duplicate tracking attempt for "${title}"`);
      logger.info(`Existing: v${existingVersion} build ${existingBuild}`);
      logger.info(`New: v${newVersion} build ${newBuild}`);

      let shouldReplace = false;
      let comparisonReason = existingGame
        ? 'This exact result is already tracked.'
        : 'A tracked variant of this game already exists.';

      if (newVersion && existingVersion) {
        const versionComparison = compareVersionStrings(newVersion, existingVersion);
        if (versionComparison > 0) {
          shouldReplace = true;
          comparisonReason = `Higher version detected: ${newVersion} > ${existingVersion}`;
        } else if (versionComparison < 0) {
          comparisonReason = `Tracked version appears newer (${existingVersion} vs ${newVersion})`;
        } else if (newBuild && existingBuild) {
          const newBuildNum = parseInt(newBuild.replace(/[^\d]/g, ''));
          const existingBuildNum = parseInt(existingBuild.replace(/[^\d]/g, ''));
          if (!isNaN(newBuildNum) && !isNaN(existingBuildNum) && newBuildNum > existingBuildNum) {
            shouldReplace = true;
            comparisonReason = `Higher build number: ${newBuild} > ${existingBuild}`;
          } else {
            comparisonReason = `Tracked build appears newer or equal (${existingBuild} vs ${newBuild || existingBuild})`;
          }
        } else {
          comparisonReason = 'Same version detected';
        }
      } else if (newBuild && existingBuild) {
        const newBuildNum = parseInt(newBuild.replace(/[^\d]/g, ''));
        const existingBuildNum = parseInt(existingBuild.replace(/[^\d]/g, ''));
        if (!isNaN(newBuildNum) && !isNaN(existingBuildNum) && newBuildNum > existingBuildNum) {
          shouldReplace = true;
          comparisonReason = `Higher build number: ${newBuild} > ${existingBuild}`;
        } else {
          comparisonReason = `Tracked build appears newer or equal (${existingBuild} vs ${newBuild || existingBuild})`;
        }
      }

      if (!forceReplace) {
        return NextResponse.json({
          error: shouldReplace
            ? 'A tracked version already exists. Replace it with this newer result?'
            : 'A tracked version already exists for this game. Replace it with the selected result?',
          confirmationRequired: true,
          reason: comparisonReason,
          existingGame: {
            gameId: replacementTarget.gameId,
            title: replacementTarget.originalTitle || replacementTarget.title,
            version: replacementTarget.lastKnownVersion || existingVersion || existingBuild || 'Unknown',
          },
          replacement: {
            gameId,
            title: originalTitle || title,
            version: [newVersion, newBuild ? `Build ${newBuild}` : ''].filter(Boolean).join(' · ') || 'Unknown',
          }
        }, { status: 409 });
      }

      logger.info(`Replacing tracked game after confirmation: ${comparisonReason}`);

      replacementTarget.gameId = gameId;
      replacementTarget.title = normalizedCleanedTitle;
      replacementTarget.originalTitle = originalTitle || title;
      replacementTarget.cleanedTitle = normalizedCleanedTitle;
      replacementTarget.source = source;
      replacementTarget.gameLink = gameLink;
      replacementTarget.image = image;
      replacementTarget.description = decodeHtmlEntities(description || '');
      replacementTarget.priority = calculateGamePriority(title, preferRepacks);
      replacementTarget.dateAdded = new Date();

      if (newVersion) {
        replacementTarget.currentVersionNumber = newVersion;
        replacementTarget.versionNumberVerified = true;
        replacementTarget.versionNumberSource = replacementTarget.steamAppId ? 'steamdb:manual-replace' : 'manual-replace';
        replacementTarget.versionNumberLastUpdated = new Date();
      }

      if (newBuild) {
        replacementTarget.currentBuildNumber = newBuild;
        replacementTarget.buildNumberVerified = true;
        replacementTarget.buildNumberSource = replacementTarget.steamAppId ? 'steamdb:manual-replace' : 'manual-replace';
        replacementTarget.buildNumberLastUpdated = new Date();
      }

      if (newVersion || newBuild) {
        replacementTarget.lastKnownVersion = [newVersion, newBuild ? `Build ${newBuild}` : ''].filter(Boolean).join(' · ');
      }

      if (replacementTarget.steamAppId) {
        let resolvedPubTs: number | null = null;

        if (replacementTarget.currentBuildNumber) {
          resolvedPubTs = await resolvePubTimestampFromBuild(replacementTarget.steamAppId, replacementTarget.currentBuildNumber);
        }

        if (!resolvedPubTs) {
          resolvedPubTs = await resolveLatestPubTimestamp(replacementTarget.steamAppId);
        }

        if (typeof resolvedPubTs === 'number' && resolvedPubTs > 0) {
          replacementTarget.lastPubTimestamp = resolvedPubTs;
        }
      }

      await replacementTarget.save();

      return NextResponse.json({
        message: shouldReplace
          ? `Tracked game updated to the selected result: ${comparisonReason}`
          : 'Tracked game relinked to the selected result.',
        game: replacementTarget,
        replaced: true
      }, { status: 200 });
    }

    // Create new tracked game
    const trackedGame = new TrackedGame({
      userId: user.id,
      gameId,
      title: normalizedCleanedTitle, // Use provided cleaned title or clean the title
      source,
      image,
      description: decodeHtmlEntities(description || ''),
      gameLink,
      originalTitle: originalTitle || title, // Use original title for Steam verification and advanced view
      cleanedTitle: normalizedCleanedTitle, // Ensure we have a cleaned title
      priority: calculateGamePriority(title, preferRepacks) // Calculate priority based on title and user preference
    });

    await trackedGame.save();

    // Attempt automatic GOG verification FIRST (priority over Steam)
    try {
      await initializeGOGDB();
      logger.info(`🔍 Auto GOG verification for newly added game: "${originalTitle || title}"`);
      
      const titleForGOG = originalTitle || title;
      const gogResults = await searchGOGDBIndex(titleForGOG, 5);
      
      if (gogResults.length > 0) {
        // Find best match (exact or highest similarity)
        const bestMatch = gogResults.find(game => 
          game.title.toLowerCase() === titleForGOG.toLowerCase()
        ) || gogResults[0];
        
        // Get latest version info
        const latestVersion = await getLatestGOGVersion(bestMatch.id, 'windows');
        
        if (latestVersion) {
          trackedGame.gogVerified = true;
          trackedGame.gogProductId = bestMatch.id;
          trackedGame.gogName = bestMatch.title;
          trackedGame.gogVersion = latestVersion.version;
          trackedGame.gogBuildId = latestVersion.buildId;
          trackedGame.gogLastChecked = new Date();
          
          logger.info(`✅ Auto GOG verification successful for "${title}": ${bestMatch.title} (ID: ${bestMatch.id})`);
          if (latestVersion.version) {
            logger.info(`📦 GOG Latest Version: ${latestVersion.version}`);
          }
          
          await trackedGame.save();
        }
      } else {
        logger.debug(`ℹ️ No GOG match found for "${title}"`);
      }
    } catch (gogError) {
      logger.warn(`⚠️ Auto GOG verification error for "${title}":`, gogError);
      // Don't fail the entire request if GOG verification fails
    }

    // Attempt automatic Steam verification
    try {
      // If we already have Steam AppID from conflict differentiation or from
      // the client search result payload, use it directly.
      if (autoSteamAppId) {
        logger.info(`✅ Using pre-resolved/provided Steam AppID`);
        trackedGame.steamVerified = true;
        trackedGame.steamAppId = parseInt(autoSteamAppId);
        if (autoSteamName) trackedGame.steamName = autoSteamName;
        if (!trackedGame.image) {
          const igdbImage = await resolveIGDBImage(cleanedTitle || cleanGameTitle(title));
          if (igdbImage) {
            trackedGame.image = igdbImage;
            logger.info(`🎨 Set IGDB image for ${trackedGame.title}`);
          }
        }
        await trackedGame.save();
        logger.info(`Steam verification complete: ${autoSteamName || 'AppID verified'} (${autoSteamAppId})`);
      } else {
        // Otherwise, attempt normal auto Steam verification
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
          if (!trackedGame.image) {
            const igdbImage = await resolveIGDBImage(cleanedTitle || cleanGameTitle(title));
            if (igdbImage) {
              trackedGame.image = igdbImage;
              logger.info(`🎨 Set IGDB image for ${trackedGame.title}`);
            }
          }
          await trackedGame.save();
          
          logger.info(`Auto Steam verification successful for "${title}": ${autoVerification.steamName} (${autoVerification.steamAppId})`);
        } else {
          logger.warn(`Auto Steam verification failed for "${title}": ${autoVerification.reason}`);
          // IGDB fallback: try to get an image from IGDB when Steam fails
          if (!trackedGame.image) {
            try {
              const igdbImage = await resolveIGDBImage(cleanedTitle || cleanGameTitle(title));
              if (igdbImage) {
                trackedGame.image = igdbImage;
                await trackedGame.save();
                logger.info(`🎨 Set IGDB fallback image for "${title}"`);
              }
            } catch (igdbError) {
              logger.debug(`IGDB image fallback failed for "${title}":`, igdbError);
            }
          }
        }
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
        let finalVersion = versionAnalysis.detectedVersion;
        let resolvedFromDate = false;
        
        // Check if this is a date-based version (YYYYMMDD format)
        const isDateVersion = /^\d{8}$/.test(finalVersion) || 
                             /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(finalVersion);
        
        // If it's a date-based version and we have Steam App ID, resolve it via SteamDB
        if (isDateVersion && trackedGame.steamAppId) {
          logger.info(`🗓️ Date-based version detected: ${finalVersion}, resolving via SteamDB...`);
          const resolved = await resolveVersionFromDate(trackedGame.steamAppId, finalVersion);
          if (resolved && resolved.version) {
            logger.info(`✅ Resolved version ${resolved.version} from date ${finalVersion} via SteamDB`);
            finalVersion = resolved.version;
            resolvedFromDate = true;
            
            // Also set the build if available
            if (resolved.build && !versionAnalysis.detectedBuild) {
              trackedGame.currentBuildNumber = resolved.build;
              trackedGame.buildNumberVerified = true;
              trackedGame.buildNumberSource = 'steamdb:date-resolved';
              logger.info(`✅ Also resolved build ${resolved.build} from date ${finalVersion} via SteamDB`);
            }
          } else {
            logger.warn(`⚠️ Could not resolve date-based version ${finalVersion}, storing as-is`);
          }
        }
        
        // Auto-verify the detected (or resolved) version
        trackedGame.currentVersionNumber = finalVersion;
        trackedGame.versionNumberVerified = true;
        trackedGame.versionNumberSource = resolvedFromDate ? 'steamdb:date-resolved' : 'auto-detected';
  logger.info(`Auto-detected and verified version for "${title}": ${finalVersion.startsWith('v') ? finalVersion : `v${finalVersion}`}${resolvedFromDate ? ' (resolved from date)' : ''}`);
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

      if (trackedGame.steamAppId) {
        let resolvedPubTs: number | null = null;

        if (trackedGame.currentBuildNumber) {
          resolvedPubTs = await resolvePubTimestampFromBuild(trackedGame.steamAppId, trackedGame.currentBuildNumber);
        }

        if (!resolvedPubTs) {
          resolvedPubTs = await resolveLatestPubTimestamp(trackedGame.steamAppId);
        }

        if (typeof resolvedPubTs === 'number' && resolvedPubTs > 0) {
          trackedGame.lastPubTimestamp = resolvedPubTs;
        }
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