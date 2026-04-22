import { NextResponse, NextRequest } from 'next/server';
import {
  computeSiteStats,
  getCachedRecent,
  refreshSiteInBackground,
} from '../../../../../../lib/recentUploadsState';

// Scraping one site through FlareSolverr can take a while on a cold Cloudflare
// challenge. The refresh itself runs in the background, but we still want a
// generous ceiling for any synchronous work in this handler.
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ site: string }>;
}

/**
 * POST /api/games/recent/site/[site]
 *
 * Kicks off a no-cache re-scrape of the named site and merges the fresh
 * posts into the in-memory recent-uploads grid without touching any other
 * site. The refresh runs in the background and the response returns
 * immediately — re-poll `/api/games/recent` a few seconds later to see the
 * updated data.
 *
 * Query params:
 *   force=true  — bypass the per-site cooldown (SITE_REFRESH_COOLDOWN_MS)
 *
 * Body: ignored (kept POST rather than GET so routine browsers and prefetch
 * heuristics don't accidentally trigger re-scrapes).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { site } = await context.params;
  const { searchParams } = new URL(request.url);
  const bypassCooldown = searchParams.get('force') === 'true';

  const result = refreshSiteInBackground(site, {
    bypassCooldown,
    reason: 'manual endpoint',
  });

  const cached = getCachedRecent();
  const stats = cached ? computeSiteStats(cached.results) : null;
  const siteStats = stats?.[site] ?? null;

  if (!result.started) {
    const code = result.reason === 'unknown-site' ? 404 : 202;
    return NextResponse.json(
      {
        success: false,
        site,
        started: false,
        reason: result.reason,
        siteStats,
      },
      { status: code }
    );
  }

  return NextResponse.json({
    success: true,
    site,
    started: true,
    bypassCooldown,
    siteStats,
    message: `Refresh started for ${site}; re-poll /api/games/recent in a few seconds to see merged results.`,
  });
}

/**
 * GET /api/games/recent/site/[site]
 *
 * Lightweight introspection — returns the current cached-grid stats for this
 * site (total / verified / unverified counts). Useful for operators and for
 * the client if we ever want to expose per-site health in the UI.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { site } = await context.params;
  const cached = getCachedRecent();
  const stats = cached ? computeSiteStats(cached.results) : null;
  const siteStats = stats?.[site] ?? null;

  if (!siteStats) {
    return NextResponse.json(
      {
        success: false,
        site,
        siteStats: null,
        error: cached ? `no stats for site: ${site}` : 'cache not populated yet',
      },
      { status: cached ? 404 : 503 }
    );
  }

  return NextResponse.json({
    success: true,
    site,
    siteStats,
  });
}
