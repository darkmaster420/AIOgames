import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';

type GridSizeInput = number | 'auto' | null | undefined;

function normalizeGridSize(value: GridSizeInput): number | 'auto' | undefined {
  if (value === 'auto' || value === null || value === undefined) return 'auto';
  const n = Number(value);
  if (!Number.isNaN(n) && n >= 1 && n <= 12) return n;
  return undefined;
}

function normalizeLayoutMode(value: unknown): 'grid' | 'horizontal' | undefined {
  return value === 'grid' || value === 'horizontal' ? value : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLayoutFields(target: Record<string, any>, source: Record<string, unknown>) {
  const layoutMode = normalizeLayoutMode(source.layoutMode);
  const customCols = normalizeGridSize(source.customCols as GridSizeInput);
  const customRows = normalizeGridSize(source.customRows as GridSizeInput);
  if (layoutMode) target.layoutMode = layoutMode;
  if (customCols !== undefined) target.customCols = customCols;
  if (customRows !== undefined) target.customRows = customRows;
}

export async function PATCH(req: Request) {
  try {
    const profile = await getCurrentUser();
    if (!profile) return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });

    const body = await req.json();
    const { homepage, tracking } = body ?? {};

    await connectDB();
    const user = await User.findById(profile.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    user.preferences = user.preferences || {};

    if (homepage && typeof homepage === 'object') {
      user.preferences.homepage = user.preferences.homepage || {};
      applyLayoutFields(user.preferences.homepage, homepage as Record<string, unknown>);
      if (typeof homepage.showRecentUploads === 'boolean') {
        user.preferences.homepage.showRecentUploads = homepage.showRecentUploads;
      }
      if (typeof homepage.showAllGames === 'boolean') {
        user.preferences.homepage.showAllGames = homepage.showAllGames;
      }
    }

    if (tracking && typeof tracking === 'object') {
      user.preferences.tracking = user.preferences.tracking || {};
      applyLayoutFields(user.preferences.tracking, tracking as Record<string, unknown>);
    }

    await user.save();

    return NextResponse.json({
      success: true,
      preferences: {
        homepage: user.preferences.homepage,
        tracking: user.preferences.tracking,
      },
    });
  } catch (error) {
    console.error('PATCH /api/user/preferences error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
