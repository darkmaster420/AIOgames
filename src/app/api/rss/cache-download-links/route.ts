import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { getCurrentUser } from '../../../../lib/auth';
import { warmRssDownloadLinksCacheBatch } from '../../../../lib/trackedGameDownloadLinks';
import logger from '../../../../utils/logger';

export const maxDuration = 180;

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.RSS_DOWNLOAD_CACHE_CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const querySecret = new URL(req.url).searchParams.get('secret')?.trim() || '';
  const candidate = bearer || querySecret;
  return timingSafeEqualStrings(candidate, secret);
}

/**
 * POST /api/rss/cache-download-links
 * Session: warm RSS download-link cache for the current user's tracked games (missing / optional stale).
 *
 * Body (optional): `{ "limit": 40, "maxAgeDays": 14 }`
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { limit?: number; maxAgeDays?: number } = {};
    try {
      body = await req.json();
    } catch {
      // empty body
    }

    const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 150);
    const maxAgeDays = body.maxAgeDays;
    const maxAgeMs =
      typeof maxAgeDays === 'number' && Number.isFinite(maxAgeDays) && maxAgeDays > 0
        ? maxAgeDays * 24 * 60 * 60 * 1000
        : undefined;

    await connectDB();
    const result = await warmRssDownloadLinksCacheBatch({
      maxGames: limit,
      userId: user.id,
      maxAgeMs,
      delayMs: 400,
    });

    logger.info(`RSS download-link cache warm (user): ${JSON.stringify(result)}`);
    return NextResponse.json({
      ok: true,
      message: 'RSS download-link cache warm finished',
      ...result,
    });
  } catch (error) {
    logger.error('RSS cache-download-links POST error:', error);
    return NextResponse.json(
      { error: 'Failed to warm RSS download cache' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/rss/cache-download-links?limit=25&maxAgeDays=7&secret=...
 * Optional cron / automation: requires `RSS_DOWNLOAD_CACHE_CRON_SECRET` (Bearer or `secret` query).
 * Warms globally (all users), rate-limited batch.
 */
export async function GET(req: NextRequest) {
  try {
    if (!cronAuthorized(req)) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          hint: 'Set RSS_DOWNLOAD_CACHE_CRON_SECRET and pass Authorization: Bearer <secret> or ?secret=',
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '25', 10), 1), 150);
    const maxAgeDaysParam = searchParams.get('maxAgeDays');
    const maxAgeDaysParsed = maxAgeDaysParam ? parseFloat(maxAgeDaysParam) : NaN;
    const maxAgeMsFromQuery =
      Number.isFinite(maxAgeDaysParsed) && maxAgeDaysParsed > 0
        ? maxAgeDaysParsed * 24 * 60 * 60 * 1000
        : undefined;
    const maxAgeMsFromEnv = process.env.RSS_CACHE_WARM_MAX_AGE_DAYS
      ? parseInt(process.env.RSS_CACHE_WARM_MAX_AGE_DAYS, 10) * 24 * 60 * 60 * 1000
      : undefined;
    const maxAgeMs = maxAgeMsFromQuery ?? maxAgeMsFromEnv;

    await connectDB();
    const result = await warmRssDownloadLinksCacheBatch({
      maxGames: limit,
      maxAgeMs,
      delayMs: 500,
    });

    logger.info(`RSS download-link cache warm (cron): ${JSON.stringify(result)}`);
    return NextResponse.json({
      ok: true,
      message: 'RSS download-link cache warm finished (global batch)',
      ...result,
    });
  } catch (error) {
    logger.error('RSS cache-download-links GET error:', error);
    return NextResponse.json(
      { error: 'Failed to warm RSS download cache' },
      { status: 500 }
    );
  }
}
