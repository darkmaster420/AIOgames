import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame, ReleaseGroupVariant } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { autoVerifyWithSteam } from '../../../../utils/autoSteamVerification';
import { cleanGameTitle, decodeHtmlEntities, resolveBuildFromVersion, resolveVersionFromBuild } from '../../../../utils/steamApi';
import { updateScheduler } from '../../../../lib/scheduler';
import { analyzeGameTitle, extractReleaseGroup } from '../../../../utils/versionDetection';
import logger from '../../../../utils/logger';

// POST: Add a custom game by name to tracking
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameName } = await req.json();

    if (!gameName || typeof gameName !== 'string' || gameName.trim().length === 0) {
      return NextResponse.json(
        { error: 'Game name is required' },
        { status: 400 }
      );
    }

    const trimmedGameName = gameName.trim();

    // Search for the game using the existing search API
    try {
      const searchUrl = `https://gameapi.a7a8524.workers.dev/?search=${encodeURIComponent(trimmedGameName)}`;
      const searchResponse = await fetch(searchUrl);

      if (!searchResponse.ok) {
        return NextResponse.json(
          { error: 'Failed to search for game' },
          { status: 503 }
        );
      }

      const searchData = await searchResponse.json();

      if (!searchData.success || !searchData.results || searchData.results.length === 0) {
        return NextResponse.json(
          { error: `No games found matching "${trimmedGameName}"` },
          { status: 404 }
        );
      }

      // Find the best match that has version/build info
      let bestMatch = null;
      const { detectVersionNumber } = await import('../../../../utils/versionDetection');
      
      // Try to find a result with version/build info, prioritizing exact matches
      const exactMatches = searchData.results.filter((game: { title: string }) => 
        game.title.toLowerCase().includes(trimmedGameName.toLowerCase()) ||
        trimmedGameName.toLowerCase().includes(game.title.toLowerCase())
      );
      
      // Check exact matches first
      for (const game of exactMatches) {
        const { found: hasVersion } = detectVersionNumber(game.title);
        const hasBuild = /\b(build|b|#)\s*\d{3,}\b/i.test(game.title);
        
        if (hasVersion || hasBuild) {
          bestMatch = game;
          break;
        }
      }
      
      // If no exact match with version/build found, check all results
      if (!bestMatch) {
        for (const game of searchData.results) {
          const { found: hasVersion } = detectVersionNumber(game.title);
          const hasBuild = /\b(build|b|#)\s*\d{3,}\b/i.test(game.title);
          
          if (hasVersion || hasBuild) {
            bestMatch = game;
            break;
          }
        }
      }
      
      // If still no match found, return error with helpful message
      if (!bestMatch) {
        const sampleTitles = searchData.results.slice(0, 3).map((game: { title: string }) => `"${game.title}"`).join(', ');
        return NextResponse.json(
          { 
            error: `No trackable versions found for "${trimmedGameName}". Found results like ${sampleTitles}, but none contain version or build information. Please search for a more specific release (e.g., "palworld v0.6.6" or "palworld build 12345").`
          },
          { status: 400 }
        );
      }

      await connectDB();

      // Check if game is already being tracked
      const existingGame = await TrackedGame.findOne({
        userId: user.id,
        gameId: bestMatch.id
      });

      if (existingGame) {
        return NextResponse.json(
          { 
            error: `"${bestMatch.title}" is already being tracked`,
            game: {
              id: existingGame._id,
              title: existingGame.title,
              source: existingGame.source
            }
          },
          { status: 409 }
        );
      }

      // Create new tracked game

      const newTrackedGame = new TrackedGame({
        userId: user.id,
        gameId: bestMatch.id,
        title: bestMatch.title,
        source: bestMatch.source || bestMatch.siteType || 'Unknown',
        image: bestMatch.image,
        description: decodeHtmlEntities(bestMatch.description || bestMatch.excerpt || ''),
        gameLink: bestMatch.link,
        dateAdded: new Date(),
        lastChecked: new Date(),
        notificationsEnabled: true,
        checkFrequency: 'daily',
        updateHistory: [],
        isActive: true,
        originalTitle: bestMatch.title,
        cleanedTitle: cleanGameTitle(bestMatch.title)
      });

      await newTrackedGame.save();

      // Attempt automatic Steam verification
      try {
        logger.info(`Auto Steam verification for newly added game: "${bestMatch.title}"`);
        
        // Try with original title first
        let autoVerification = await autoVerifyWithSteam(bestMatch.title, 0.85);
        
        // If original title fails, try with cleaned title
        if (!autoVerification.success) {
          const cleanedTitle = cleanGameTitle(bestMatch.title);
          if (cleanedTitle !== bestMatch.title.toLowerCase().trim()) {
            logger.debug(`Retry auto Steam verification with cleaned title: "${cleanedTitle}"`);
            autoVerification = await autoVerifyWithSteam(cleanedTitle, 0.80); // Slightly lower threshold for cleaned title
          }
        }
        
        if (autoVerification.success && autoVerification.steamAppId && autoVerification.steamName) {
          // Update the game with Steam verification data
          newTrackedGame.steamVerified = true;
          newTrackedGame.steamAppId = autoVerification.steamAppId;
          newTrackedGame.steamName = autoVerification.steamName;
          await newTrackedGame.save();
          
          logger.info(`Auto Steam verification successful for "${bestMatch.title}": ${autoVerification.steamName} (${autoVerification.steamAppId})`);
        } else {
          logger.warn(`Auto Steam verification failed for "${bestMatch.title}": ${autoVerification.reason}`);
        }
      } catch (verificationError) {
        logger.error(`Auto Steam verification error for "${bestMatch.title}":`, verificationError);
        // Don't fail the entire request if Steam verification fails
      }

      // Attempt automatic version detection and verification (and resolve via SteamDB)
      try {
        logger.debug(`Attempting auto version detection for newly added game: "${bestMatch.title}"`);
        
        const versionAnalysis = analyzeGameTitle(bestMatch.title);
        
        if (versionAnalysis.detectedVersion) {
          // Auto-verify the detected version
          newTrackedGame.currentVersionNumber = versionAnalysis.detectedVersion;
          newTrackedGame.versionNumberVerified = true;
          newTrackedGame.versionNumberSource = 'auto-detected';
          logger.info(`Auto-detected and verified version for "${bestMatch.title}": v${versionAnalysis.detectedVersion}`);
        }
        
        if (versionAnalysis.detectedBuild) {
          // Auto-verify the detected build number
          newTrackedGame.currentBuildNumber = versionAnalysis.detectedBuild;
          newTrackedGame.buildNumberVerified = true;
          newTrackedGame.buildNumberSource = 'auto-detected';
          logger.info(`Auto-detected and verified build for "${bestMatch.title}": Build #${versionAnalysis.detectedBuild}`);
        }

        // If we have a Steam App ID and only one side, try to resolve the other via SteamDB
        if (newTrackedGame.steamAppId) {
          try {
            if (newTrackedGame.currentVersionNumber && !newTrackedGame.currentBuildNumber) {
              const build = await resolveBuildFromVersion(newTrackedGame.steamAppId, newTrackedGame.currentVersionNumber);
              if (build) {
                newTrackedGame.currentBuildNumber = build;
                newTrackedGame.buildNumberVerified = true;
                newTrackedGame.buildNumberSource = 'steamdb:auto';
                logger.info(`Resolved build ${build} from version ${newTrackedGame.currentVersionNumber} via SteamDB`);
              }
            } else if (!newTrackedGame.currentVersionNumber && newTrackedGame.currentBuildNumber) {
              const version = await resolveVersionFromBuild(newTrackedGame.steamAppId, newTrackedGame.currentBuildNumber);
              if (version) {
                newTrackedGame.currentVersionNumber = version;
                newTrackedGame.versionNumberVerified = true;
                newTrackedGame.versionNumberSource = 'steamdb:auto';
                logger.info(`Resolved version ${version} from build ${newTrackedGame.currentBuildNumber} via SteamDB`);
              }
            }
          } catch (e) {
            logger.debug('SteamDB resolution skipped:', e instanceof Error ? e.message : 'unknown');
          }
        }
        
        // Compose a friendly lastKnownVersion for UI if any verified value exists
        const hasVersion = !!newTrackedGame.currentVersionNumber;
        const hasBuild = !!newTrackedGame.currentBuildNumber;
        if (hasVersion || hasBuild) {
          const versionLabel = hasVersion ? `v${newTrackedGame.currentVersionNumber}` : '';
          const buildLabel = hasBuild ? `Build ${newTrackedGame.currentBuildNumber}` : '';
          newTrackedGame.lastKnownVersion = [versionLabel, buildLabel].filter(Boolean).join(' · ');
        }

        // Save the updates
        await newTrackedGame.save();
        
      } catch (versionError) {
        logger.error(`Auto version detection error for "${bestMatch.title}":`, versionError);
        // Don't fail the entire request if version detection fails
      }

      // Attempt to extract and store release group information
      try {
        logger.debug(`Attempting release group extraction for newly added game: "${bestMatch.title}"`);
        
        const releaseGroupResult = extractReleaseGroup(bestMatch.title);
        
        if (releaseGroupResult.releaseGroup && releaseGroupResult.releaseGroup !== 'UNKNOWN') {
          logger.debug(`Detected release group: ${releaseGroupResult.releaseGroup}`);
          
          // Check if this release group variant already exists for this game
          const existingVariant = await ReleaseGroupVariant.findOne({
            trackedGameId: newTrackedGame._id,
            releaseGroup: releaseGroupResult.releaseGroup
          });

          if (!existingVariant) {
            const variant = new ReleaseGroupVariant({
              trackedGameId: newTrackedGame._id,
              gameId: bestMatch.id,
              releaseGroup: releaseGroupResult.releaseGroup,
              source: bestMatch.source || bestMatch.siteType || 'Unknown',
              title: bestMatch.title,
              gameLink: bestMatch.link,
              version: newTrackedGame.currentVersionNumber || "",
              buildNumber: newTrackedGame.currentBuildNumber || "",
              dateFound: new Date()
            });
            await variant.save();
            logger.debug(`Stored release group variant: ${releaseGroupResult.releaseGroup} for game "${bestMatch.title}"`);
          } else {
            logger.debug(`Release group variant ${releaseGroupResult.releaseGroup} already exists for this game`);
          }
        } else {
          logger.debug(`No release group detected in title: "${bestMatch.title}"`);
        }
        
      } catch (releaseGroupError) {
        logger.error(`Release group extraction error for "${bestMatch.title}":`, releaseGroupError);
        // Don't fail the entire request if release group extraction fails
      }

      // Update user's scheduler after adding a game
      try {
        await updateScheduler.updateUserSchedule(user.id);
      } catch (schedulerError) {
        logger.error('Failed to update scheduler:', schedulerError);
        // Don't fail the request if scheduler update fails
      }

      return NextResponse.json({
        message: `Successfully added "${bestMatch.title}" to your tracking list`,
        game: {
          id: newTrackedGame._id,
          gameId: newTrackedGame.gameId,
          title: newTrackedGame.title,
          source: newTrackedGame.source,
          image: newTrackedGame.image,
          description: newTrackedGame.description,
          dateAdded: newTrackedGame.dateAdded
        },
        searchResults: searchData.results.slice(0, 5).map((game: {
          id: string;
          title: string;
          source?: string;
          siteType?: string;
          image?: string;
        }) => ({
          id: game.id,
          title: game.title,
          source: game.source || game.siteType,
          image: game.image,
          isSelected: game.id === bestMatch.id
        }))
      });

    } catch (searchError) {
      console.error('Error searching for game:', searchError);
      return NextResponse.json(
        { error: 'Failed to search for game. Please try again.' },
        { status: 503 }
      );
    }

  } catch (error) {
    console.error('Error adding custom game:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}