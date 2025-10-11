import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { cleanGameTitle } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';

// POST: Migrate old tracked games to have proper cleaned/original title separation
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is admin (you can add admin role check here if needed)
    // For now, allow any authenticated user to migrate their own games

    await connectDB();

    // Find games that need migration:
    // 1. Games where originalTitle is missing or same as title
    // 2. Games where title appears to be uncleaned (contains common uncleaned patterns)
    const gamesToMigrate = await TrackedGame.find({
      userId: user.id,
      isActive: true,
      $or: [
        { originalTitle: { $exists: false } },
        { originalTitle: null },
        { originalTitle: "" },
        { $expr: { $eq: ["$title", "$originalTitle"] } },
        // Look for titles that likely need cleaning (contain release info, versions, etc.)
        { title: { $regex: /\b(v\d+\.\d+|release|repack|update|hotfix|dlc|goty|edition|build|\[|\]|\(.*\))/i } }
      ]
    });

    let migratedCount = 0;
    const migrationResults = [];

    for (const game of gamesToMigrate) {
      try {
        const originalTitle = game.title; // Current title becomes original
        const cleanedTitle = cleanGameTitle(game.title); // Clean the title
        
        // Only update if the cleaned title is actually different
        if (cleanedTitle !== originalTitle) {
          await TrackedGame.updateOne(
            { _id: game._id },
            {
              $set: {
                title: cleanedTitle,
                originalTitle: originalTitle,
                cleanedTitle: cleanedTitle
              }
            }
          );

          migrationResults.push({
            gameId: game.gameId,
            oldTitle: originalTitle,
            newTitle: cleanedTitle,
            migrated: true
          });
          
          migratedCount++;
          logger.info(`Migrated title for game ${game.gameId}: "${originalTitle}" -> "${cleanedTitle}"`);
        } else {
          // Still ensure originalTitle is set even if no cleaning needed
          if (!game.originalTitle || game.originalTitle === game.title) {
            await TrackedGame.updateOne(
              { _id: game._id },
              {
                $set: {
                  originalTitle: originalTitle,
                  cleanedTitle: cleanedTitle
                }
              }
            );
            
            migrationResults.push({
              gameId: game.gameId,
              oldTitle: originalTitle,
              newTitle: cleanedTitle,
              migrated: false,
              reason: 'No cleaning needed, but ensured originalTitle is set'
            });
          }
        }
      } catch (error) {
        logger.error(`Failed to migrate game ${game.gameId}:`, error);
        migrationResults.push({
          gameId: game.gameId,
          error: error instanceof Error ? error.message : 'Unknown error',
          migrated: false
        });
      }
    }

    logger.info(`Title migration completed: ${migratedCount} games migrated out of ${gamesToMigrate.length} candidates`);

    return NextResponse.json({
      success: true,
      message: `Successfully migrated ${migratedCount} games`,
      totalCandidates: gamesToMigrate.length,
      migratedCount,
      results: migrationResults
    });

  } catch (error) {
    logger.error('Title migration error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to migrate titles',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET: Check how many games need migration
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

    const gamesToMigrate = await TrackedGame.find({
      userId: user.id,
      isActive: true,
      $or: [
        { originalTitle: { $exists: false } },
        { originalTitle: null },
        { originalTitle: "" },
        { $expr: { $eq: ["$title", "$originalTitle"] } },
        { title: { $regex: /\b(v\d+\.\d+|release|repack|update|hotfix|dlc|goty|edition|build|\[|\]|\(.*\))/i } }
      ]
    }).select('gameId title originalTitle');

    const preview = gamesToMigrate.map(game => ({
      gameId: game.gameId,
      currentTitle: game.title,
      wouldBecomeTitle: cleanGameTitle(game.title),
      wouldBecomeOriginal: game.title,
      needsCleaning: cleanGameTitle(game.title) !== game.title
    }));

    return NextResponse.json({
      totalGames: gamesToMigrate.length,
      needsMigration: preview.filter(p => p.needsCleaning).length,
      preview: preview.slice(0, 10) // Show first 10 as preview
    });

  } catch (error) {
    logger.error('Title migration check error:', error);
    return NextResponse.json(
      { error: 'Failed to check migration status' },
      { status: 500 }
    );
  }
}