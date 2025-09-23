import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { validateVersionNumber, normalizeVersionNumber } from '../../../../utils/versionDetection';

// POST: Verify version number for a game
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { gameId, versionNumber, source = 'manual' } = await request.json();

    if (!gameId || !versionNumber) {
      return NextResponse.json(
        { error: 'Game ID and version number are required' },
        { status: 400 }
      );
    }

    // Validate version number format
    const validation = validateVersionNumber(versionNumber);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid version number format' },
        { status: 400 }
      );
    }

    const normalizedVersion = normalizeVersionNumber(versionNumber);

    await connectDB();

    // Find the tracked game
    const trackedGame = await TrackedGame.findOne({ gameId });
    
    if (!trackedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    // Update the game with version number information
    const updateResult = await TrackedGame.findOneAndUpdate(
      { gameId },
      {
        versionNumberVerified: true,
        currentVersionNumber: normalizedVersion,
        versionNumberSource: source,
        versionNumberLastUpdated: new Date(),
        versionNumberVerifiedBy: user.id
      },
      { new: true } // Return the updated document
    );

    console.log(`📋 Version number verified for "${trackedGame.title}": v${normalizedVersion} (by ${user.name})`);

    return NextResponse.json({
      success: true,
      message: 'Version number verified successfully',
      versionNumber: normalizedVersion,
      gameTitle: trackedGame.title,
      game: {
        gameId: updateResult.gameId,
        versionNumberVerified: updateResult.versionNumberVerified,
        currentVersionNumber: updateResult.currentVersionNumber,
        versionNumberSource: updateResult.versionNumberSource,
        versionNumberLastUpdated: updateResult.versionNumberLastUpdated
      }
    });

  } catch (error) {
    console.error('Error verifying version number:', error);
    return NextResponse.json(
      { error: 'Failed to verify version number' },
      { status: 500 }
    );
  }
}

// DELETE: Remove version number verification
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { gameId } = await request.json();

    if (!gameId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find the tracked game
    const trackedGame = await TrackedGame.findOne({ gameId });
    if (!trackedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    // Remove version number verification
    await TrackedGame.findOneAndUpdate(
      { gameId },
      {
        $unset: {
          versionNumberVerified: '',
          currentVersionNumber: '',
          versionNumberSource: '',
          versionNumberLastUpdated: '',
          versionNumberVerifiedBy: ''
        }
      }
    );

    console.log(`🗑️ Version number verification removed for "${trackedGame.title}" (by ${user.name})`);

    return NextResponse.json({
      success: true,
      message: 'Version number verification removed successfully',
      gameTitle: trackedGame.title
    });

  } catch (error) {
    console.error('Error removing version number verification:', error);
    return NextResponse.json(
      { error: 'Failed to remove version number verification' },
      { status: 500 }
    );
  }
}

// GET: Get version number info for a game
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find the tracked game
    const trackedGame = await TrackedGame.findOne({ gameId })
      .populate('versionNumberVerifiedBy', 'name email')
      .select('title versionNumberVerified currentVersionNumber versionNumberSource versionNumberLastUpdated versionNumberVerifiedBy');

    if (!trackedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      gameTitle: trackedGame.title,
      versionNumberVerified: trackedGame.versionNumberVerified || false,
      currentVersionNumber: trackedGame.currentVersionNumber || '',
      versionNumberSource: trackedGame.versionNumberSource || '',
      versionNumberLastUpdated: trackedGame.versionNumberLastUpdated || null,
      versionNumberVerifiedBy: trackedGame.versionNumberVerifiedBy || null
    });

  } catch (error) {
    console.error('Error fetching version number info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch version number information' },
      { status: 500 }
    );
  }
}