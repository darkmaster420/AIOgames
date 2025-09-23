import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

// POST: Verify build number for a game
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { gameId, buildNumber, source = 'steamdb' } = await request.json();

    if (!gameId || !buildNumber) {
      return NextResponse.json(
        { error: 'Game ID and build number are required' },
        { status: 400 }
      );
    }

    // Validate build number format (should be numeric)
    if (!/^\d+$/.test(buildNumber.trim())) {
      return NextResponse.json(
        { error: 'Build number must contain only digits' },
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

    // Update the game with build number information
    await TrackedGame.findOneAndUpdate(
      { gameId },
      {
        buildNumberVerified: true,
        currentBuildNumber: buildNumber.trim(),
        buildNumberSource: source,
        buildNumberLastUpdated: new Date(),
        buildNumberVerifiedBy: user.id
      }
    );

    console.log(`🔢 Build number verified for "${trackedGame.title}": ${buildNumber} (by ${user.name})`);

    return NextResponse.json({
      success: true,
      message: 'Build number verified successfully',
      buildNumber: buildNumber.trim(),
      gameTitle: trackedGame.title
    });

  } catch (error) {
    console.error('Error verifying build number:', error);
    return NextResponse.json(
      { error: 'Failed to verify build number' },
      { status: 500 }
    );
  }
}

// DELETE: Remove build number verification
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

    // Remove build number verification
    await TrackedGame.findOneAndUpdate(
      { gameId },
      {
        $unset: {
          buildNumberVerified: '',
          currentBuildNumber: '',
          buildNumberSource: '',
          buildNumberLastUpdated: '',
          buildNumberVerifiedBy: ''
        }
      }
    );

    console.log(`🗑️ Build number verification removed for "${trackedGame.title}" (by ${user.name})`);

    return NextResponse.json({
      success: true,
      message: 'Build number verification removed successfully',
      gameTitle: trackedGame.title
    });

  } catch (error) {
    console.error('Error removing build number verification:', error);
    return NextResponse.json(
      { error: 'Failed to remove build number verification' },
      { status: 500 }
    );
  }
}

// GET: Get build number info for a game
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
      .populate('buildNumberVerifiedBy', 'name email')
      .select('title buildNumberVerified currentBuildNumber buildNumberSource buildNumberLastUpdated buildNumberVerifiedBy');

    if (!trackedGame) {
      return NextResponse.json(
        { error: 'Tracked game not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      gameTitle: trackedGame.title,
      buildNumberVerified: trackedGame.buildNumberVerified || false,
      currentBuildNumber: trackedGame.currentBuildNumber || '',
      buildNumberSource: trackedGame.buildNumberSource || '',
      buildNumberLastUpdated: trackedGame.buildNumberLastUpdated || null,
      buildNumberVerifiedBy: trackedGame.buildNumberVerifiedBy || null
    });

  } catch (error) {
    console.error('Error fetching build number info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch build number information' },
      { status: 500 }
    );
  }
}