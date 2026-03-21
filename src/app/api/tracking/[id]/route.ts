import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Game ID is required' }, { status: 400 });
    }

    await connectDB();

    const game = await TrackedGame.findOne({
      _id: id,
      userId: user.id,
      isActive: true,
    }).select('gameId title originalTitle cleanedTitle source image description gameLink steamAppId steamName steamVerified dateAdded lastChecked lastKnownVersion currentVersionNumber currentBuildNumber notificationsEnabled');

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({ game });
  } catch (error) {
    console.error('Get tracked game by id error:', error);
    return NextResponse.json({ error: 'Failed to fetch tracked game' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Game ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { version, gameLink, title } = body;

    if (!version || typeof version !== 'string' || !version.trim()) {
      return NextResponse.json({ error: 'version is required' }, { status: 400 });
    }

    await connectDB();

    const game = await TrackedGame.findOne({ _id: id, userId: user.id, isActive: true });
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const now = new Date();
    const newVersion = version.trim();
    const newLink = (gameLink || game.gameLink || '').trim();

    // Mark all existing history entries as not latest
    if (game.updateHistory) {
      game.updateHistory.forEach((entry: { isLatest?: boolean }) => { entry.isLatest = false; });
    }

    game.updateHistory.unshift({
      version: newVersion,
      dateFound: now,
      gameLink: newLink,
      isLatest: true,
      confirmedByUser: true,
      originalReason: title ? `Manually marked as latest from appid page: ${title}` : 'Manually marked as latest from appid page',
    });

    game.lastKnownVersion = newVersion;
    if (newLink) game.gameLink = newLink;
    game.latestApprovedUpdate = { version: newVersion, dateFound: now, gameLink: newLink };
    game.hasNewUpdate = false;
    game.newUpdateSeen = true;

    await game.save();

    return NextResponse.json({ success: true, lastKnownVersion: newVersion });
  } catch (error) {
    console.error('PATCH tracked game error:', error);
    return NextResponse.json({ error: 'Failed to update tracked game' }, { status: 500 });
  }
}
