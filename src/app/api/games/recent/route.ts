import { NextResponse, NextRequest } from 'next/server';
import {
  CACHE_TTL_MS,
  Game,
  SiteStat,
  enrichAppIdsInBackground,
  enrichInBackground,
  fetchAndCacheRecent,
  getCachedRecent,
  hasNativeAppId,
  prefetchImageBytesInBackground,
  runAutoRecovery,
  triggerReverify,
} from '../../../../lib/recentUploadsState';

// Allow up to 2 minutes for initial data fetch (scraping multiple sites via FlareSolverr)
export const maxDuration = 120;

function buildStatsHeader(stats: Record<string, SiteStat>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(stats).map(([k, s]) => [
        k,
        { total: s.total, verified: s.verified, unverified: s.unverified },
      ])
    )
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const site = searchParams.get('site') || 'all';
    const forceRefresh = searchParams.get('refresh') === 'true';
    // Client can ask for a full re-verification pass without re-scraping the
    // source sites. Clears the per-title failure cooldowns so every
    // unverified game gets another IGDB/Steam attempt on this request's
    // background enrichment cycle.
    const forceReverify = searchParams.get('reverify') === 'true';

    const now = Date.now();
    let results: Game[];
    let isFromCache = false;
    let manualReverifyRan = false;

    if (forceReverify) {
      // Manual reverify bypasses the internal cooldown.
      manualReverifyRan = triggerReverify('manual ?reverify=true', { bypassCooldown: true });
    }

    const cached = getCachedRecent();
    if (
      !forceRefresh &&
      cached &&
      (now - cached.timestamp) < CACHE_TTL_MS &&
      cached.siteKey === 'all'
    ) {
      results = cached.results;
      isFromCache = true;

      // Kick off background re-enrichment for any games still missing images
      // or Steam AppIDs, and warm the image byte cache for anything that's
      // not already resident. All update the cache in-place.
      enrichInBackground();
      enrichAppIdsInBackground();
      prefetchImageBytesInBackground();
    } else {
      const { results: fresh, error } = await fetchAndCacheRecent();
      if (error) {
        return NextResponse.json({ error }, { status: 500 });
      }
      results = fresh;
    }

    // Auto-recovery: inspect the just-cached grid for empty sites and for
    // sites whose verified:unverified ratio is unhealthy, and kick off the
    // appropriate background actions (per-site rescrape / full reverify).
    // Rate-limited internally so a persistent upstream failure doesn't put
    // us in a hot loop.
    const recovery = runAutoRecovery(results);

    // Apply local site filtering
    let finalResults = results;
    if (site && site !== 'all') {
      finalResults = results.filter((game: Game) => game.siteType === site);
    }

    const cachedAfter = getCachedRecent();
    const cacheAge = isFromCache && cachedAfter ? Math.floor((now - cachedAfter.timestamp) / 1000) : 0;
    const remainingTTL = cachedAfter
      ? Math.max(0, Math.floor((CACHE_TTL_MS - (now - cachedAfter.timestamp)) / 1000))
      : 0;
    const pendingImages = results.filter((g: Game) => !g.image).length;
    const pendingAppIds = results.filter((g: Game) => !hasNativeAppId(g)).length;

    return NextResponse.json(finalResults, {
      headers: {
        // Browser-side caching disabled — server in-memory cache is the only cache.
        'Cache-Control': 'no-store, must-revalidate',
        'X-Cache-Status': isFromCache ? 'HIT' : 'MISS',
        'X-Cache-Age': cacheAge.toString(),
        'X-Cache-TTL': remainingTTL.toString(),
        // X-Pending-* are retained for observability (e.g. curl / debugging
        // the enrichment pipeline). The dashboard no longer polls on these;
        // enrichment is kept warm server-side by the 25-minute scheduler
        // warmCache cycle and by on-demand enrichInBackground triggers on
        // every request.
        'X-Pending-Images': pendingImages.toString(),
        'X-Pending-AppIds': pendingAppIds.toString(),
        // Auto-recovery diagnostics — visible via `curl -I` so operators can
        // see which sites were empty, which tripped the ratio threshold,
        // which were actually re-scraped, and whether a reverify ran.
        'X-Empty-Sites': recovery.emptySites.join(',') || '-',
        'X-Overloaded-Sites': recovery.overloadedSites.join(',') || '-',
        'X-Refreshed-Sites': recovery.refreshedSites.join(',') || '-',
        'X-Reverify-Triggered': (recovery.reverifyTriggered || manualReverifyRan) ? '1' : '0',
        'X-Reverify-Source': manualReverifyRan
          ? 'manual'
          : (recovery.reverifyTriggered ? 'auto-ratio' : '-'),
        'X-Site-Stats': buildStatsHeader(recovery.stats),
      }
    });
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}
