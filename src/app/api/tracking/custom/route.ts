import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { autoVerifyWithSteam } from '../../../../utils/autoSteamVerification';
import { cleanGameTitle } from '../../../../utils/steamApi';

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

      // Find the best match (first result or exact title match)
      let bestMatch = searchData.results[0];
      
      // Look for exact title match (case insensitive)
      const exactMatch = searchData.results.find((game: { title: string }) => 
        game.title.toLowerCase().includes(trimmedGameName.toLowerCase()) ||
        trimmedGameName.toLowerCase().includes(game.title.toLowerCase())
      );
      
      if (exactMatch) {
        bestMatch = exactMatch;
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
        description: bestMatch.description || bestMatch.excerpt || '',
        gameLink: bestMatch.link,
        lastKnownVersion: 'Initial Release',
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
        console.log(`🔍 Attempting auto Steam verification for newly added game: "${bestMatch.title}"`);
        
        // Try with original title first
        let autoVerification = await autoVerifyWithSteam(bestMatch.title, 0.85);
        
        // If original title fails, try with cleaned title
        if (!autoVerification.success) {
          const cleanedTitle = cleanGameTitle(bestMatch.title);
          if (cleanedTitle !== bestMatch.title.toLowerCase().trim()) {
            console.log(`🔄 Retrying auto Steam verification with cleaned title: "${cleanedTitle}"`);
            autoVerification = await autoVerifyWithSteam(cleanedTitle, 0.80); // Slightly lower threshold for cleaned title
          }
        }
        
        if (autoVerification.success && autoVerification.steamAppId && autoVerification.steamName) {
          // Update the game with Steam verification data
          newTrackedGame.steamVerified = true;
          newTrackedGame.steamAppId = autoVerification.steamAppId;
          newTrackedGame.steamName = autoVerification.steamName;
          await newTrackedGame.save();
          
          console.log(`✅ Auto Steam verification successful for "${bestMatch.title}": ${autoVerification.steamName} (${autoVerification.steamAppId})`);
        } else {
          console.log(`⚠️ Auto Steam verification failed for "${bestMatch.title}": ${autoVerification.reason}`);
        }
      } catch (verificationError) {
        console.error(`❌ Auto Steam verification error for "${bestMatch.title}":`, verificationError);
        // Don't fail the entire request if Steam verification fails
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