import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { getCurrentUser } from '../../../../lib/auth';
import { LibraryGame, LibraryScanJob } from '../../../../lib/models';
import { getLibraryRoot } from '../../../../lib/libraryConfig';
import { runLibraryScan } from '../../../../lib/libraryScanner';

export const maxDuration = 120;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();
  const [latest, totalIndexed] = await Promise.all([
    LibraryScanJob.findOne().sort({ startedAt: -1 }).lean(),
    LibraryGame.countDocuments({ isActive: true }),
  ]);

  return NextResponse.json({
    enabled: Boolean(getLibraryRoot()),
    libraryRootConfigured: Boolean(getLibraryRoot()),
    totalIndexed,
    latest,
  });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runLibraryScan(user.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Library scan failed';
    const status = message.includes('LIBRARY_ROOT') || message.includes('Cannot read library folder')
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
