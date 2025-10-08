import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { autoVerifyWithSteam } from '../../../../utils/autoSteamVerification';
import { cleanGameTitle, decodeHtmlEntities, resolveBuildFromVersion, resolveVersionFromBuild } from '../../../../utils/steamApi';
import { updateScheduler } from '../../../../lib/scheduler';
import { analyzeGameTitle } from '../../../../utils/versionDetection';
import { searchIGDB, type IGDBSearchResult } from '../../../../utils/igdb';
import logger from '../../../../utils/logger';
import { rateLimit, validateInput, schemas } from '../../../../utils/validation';

// Helper function to calculate similarity between two strings
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // Check if one is contained in the other (but with length consideration)
  if (s1.includes(s2) || s2.includes(s1)) {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length <= s2.length ? s1 : s2;
    return shorter.length / longer.length;
  }
  
  // Word-based similarity
  const words1 = s1.split(/\s+/).filter(w => w.length > 2); // Filter out short words
  const words2 = s2.split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const intersection = words1.filter(word => words2.includes(word));
  const union = Array.from(new Set([...words1, ...words2]));
  
  return intersection.length / union.length;
}

// POST: Add a custom game by name to tracking
export async function POST(req: NextRequest) {
  try {
    // Apply rate limiting - 10 requests per minute for game adding
    const rateLimitCheck = rateLimit({ 
      maxRequests: 10, 
      windowMs: 60 * 1000,
      message: 'Too many game additions. Please wait before adding more games.'
    })(req);

    if (!rateLimitCheck.allowed) {
      return rateLimitCheck.response!;
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate input
    const validation = await validateInput(schemas.gameAdd)(req);
    if (!validation.valid) {
      return validation.response!;
    }

    const { gameName } = validation.data!;
    // TODO: Implement forceAdd functionality
    const authenticatedUser = user as { id: string; email: string; name: string };

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

      let bestMatch = null;
      let isFromIGDB = false;
      const { detectVersionNumber } = await import('../../../../utils/versionDetection');

      // First try piracy sites
      if (searchData.success && searchData.results && searchData.results.length > 0) {
        // Calculate similarity scores for all results
        const scoredResults = searchData.results.map((game: { title: string; id: string }) => {
          const similarity = calculateSimilarity(trimmedGameName, game.title);
          const { found: hasVersion } = detectVersionNumber(game.title);
          const hasBuild = /\b(build|b|#)\s*\d{3,}\b/i.test(game.title);
          
          return {
            ...game,
            similarity,
            hasVersion: hasVersion || hasBuild
          };
        });

        // Sort by version status first, then by similarity
        scoredResults.sort((a: typeof scoredResults[0], b: typeof scoredResults[0]) => {
          if (a.hasVersion && !b.hasVersion) return -1;
          if (!a.hasVersion && b.hasVersion) return 1;
          return b.similarity - a.similarity;
        });

        // For versioned games, accept any similarity > 0.3
        // For unreleased games, require much higher similarity (> 0.7)
        for (const game of scoredResults) {
          if (game.hasVersion && game.similarity > 0.3) {
            bestMatch = game;
            logger.info(`Selected versioned game from piracy sites: "${game.title}" (similarity: ${game.similarity.toFixed(2)})`);
            break;
          }
        }

        // If no versioned game found, check for unreleased games with high similarity
        if (!bestMatch) {
          logger.info(`No versioned games found for "${trimmedGameName}", checking for unreleased games on piracy sites`);
          
          const unreleasedCandidates = scoredResults.filter((game: typeof scoredResults[0]) => !game.hasVersion && game.similarity > 0.7);
          
          if (unreleasedCandidates.length > 0) {
            bestMatch = unreleasedCandidates[0];
            logger.info(`Selected unreleased game from piracy sites: "${bestMatch.title}" (similarity: ${bestMatch.similarity.toFixed(2)})`);
          }
        }
      }

      // If no suitable match found in piracy sites, try IGDB for unreleased/upcoming games
      if (!bestMatch) {
        logger.info(`No suitable matches found on piracy sites for "${trimmedGameName}", searching IGDB for unreleased games...`);
        
        try {
          const igdbResults = await searchIGDB(trimmedGameName);
          
          if (igdbResults.length > 0) {
            // Find the best IGDB match
            const igdbScoredResults = igdbResults.map((game: IGDBSearchResult) => {
              const similarity = calculateSimilarity(trimmedGameName, game.title);
              return {
                ...game,
                similarity
              };
            });

            // Sort by similarity and pick the best match (require > 0.5 similarity for IGDB)
            igdbScoredResults.sort((a, b) => b.similarity - a.similarity);
            
            if (igdbScoredResults[0].similarity > 0.5) {
              const igdbMatch = igdbScoredResults[0];
              bestMatch = {
                id: igdbMatch.id,
                title: igdbMatch.title,
                description: igdbMatch.description,
                image: igdbMatch.image,
                link: igdbMatch.url || `https://www.igdb.com/games/${igdbMatch.title.toLowerCase().replace(/\s+/g, '-')}`,
                source: 'IGDB',
                siteType: 'IGDB',
                similarity: igdbMatch.similarity
              };
              isFromIGDB = true;
              logger.info(`Selected game from IGDB: "${bestMatch.title}" (similarity: ${bestMatch.similarity.toFixed(2)})`);
            }
          }
        } catch (igdbError) {
          logger.error('IGDB search error:', igdbError);
          // Continue with the original error flow if IGDB fails
        }
      }

      // If still no match found after both piracy sites and IGDB
      if (!bestMatch) {
        const piracySitesMessage = searchData.results && searchData.results.length > 0 
          ? `Found ${searchData.results.length} results on piracy sites but none were suitable matches.`
          : 'No results found on piracy sites.';
        
        return NextResponse.json(
          { 
            error: `No suitable match found for "${trimmedGameName}". ${piracySitesMessage} IGDB search also yielded no matches. Please try a more specific search term that closely matches the exact game title.`
          },
          { status: 404 }
        );
      }

      await connectDB();

      // Check if game is already being tracked
      const existingGame = await TrackedGame.findOne({
        userId: authenticatedUser.id,
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
        userId: authenticatedUser.id,
        gameId: bestMatch.id,
        title: bestMatch.title,
        source: bestMatch.source || bestMatch.siteType || 'Unknown',
        image: bestMatch.image,
        description: decodeHtmlEntities(bestMatch.description || bestMatch.excerpt || ''),
        gameLink: bestMatch.link,
        dateAdded: new Date(),
        lastChecked: new Date(),
        notificationsEnabled: true,
        checkFrequency: 'hourly',
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
          const versionLabel = hasVersion ? newTrackedGame.currentVersionNumber : '';
          const buildLabel = hasBuild ? `Build ${newTrackedGame.currentBuildNumber}` : '';
          newTrackedGame.lastKnownVersion = [versionLabel, buildLabel].filter(Boolean).join(' · ');
        }

        // Save the updates
        await newTrackedGame.save();
        
      } catch (versionError) {
        logger.error(`Auto version detection error for "${bestMatch.title}":`, versionError);
        // Don't fail the entire request if version detection fails
      }

      // Update user's scheduler after adding a game
      try {
        await updateScheduler.updateUserSchedule(authenticatedUser.id);
      } catch (schedulerError) {
        logger.error('Failed to update scheduler:', schedulerError);
        // Don't fail the request if scheduler update fails
      }

      // Determine if this is a versioned game or unreleased game for the success message
      const { found: hasVersion } = detectVersionNumber(bestMatch.title);
      const hasBuild = /\b(build|b|#)\s*\d{3,}\b/i.test(bestMatch.title);
      const isUnreleased = !hasVersion && !hasBuild;
      const similarity = bestMatch.similarity || calculateSimilarity(trimmedGameName, bestMatch.title);
      
      let successMessage;
      if (isFromIGDB) {
        successMessage = `Successfully added upcoming/unreleased game "${bestMatch.title}" from IGDB to your tracking list (${(similarity * 100).toFixed(0)}% match). You'll be notified when it becomes available on piracy sites.`;
      } else {
        successMessage = isUnreleased
          ? `Successfully added unreleased game "${bestMatch.title}" to your tracking list (${(similarity * 100).toFixed(0)}% match). Update detection will be limited until a versioned release is available.`
          : `Successfully added "${bestMatch.title}" to your tracking list (${(similarity * 100).toFixed(0)}% match)`;
      }

      return NextResponse.json({
        message: successMessage,
        game: {
          id: newTrackedGame._id,
          gameId: newTrackedGame.gameId,
          title: newTrackedGame.title,
          source: newTrackedGame.source,
          image: newTrackedGame.image,
          description: newTrackedGame.description,
          dateAdded: newTrackedGame.dateAdded
        },
        searchResults: isFromIGDB ? [] : (searchData.results || []).slice(0, 5).map((game: {
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
      logger.error('Error searching for game:', searchError);
      return NextResponse.json(
        { error: 'Failed to search for game. Please try again.' },
        { status: 503 }
      );
    }

  } catch (error) {
    logger.error('Error adding custom game:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}