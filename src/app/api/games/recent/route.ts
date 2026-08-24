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
import { resolveSteamAppIdsBatch } from '../../../../utils/steamAppIdResolver';
import { resolveIGDBImage } from '../../../../utils/igdb';
import { cleanGameTitle } from '../../../../utils/steamApi';

// Allow up to 2 minutes for initial data fetch (scraping multiple sites via FlareSolverr)
export const maxDuration = 120;

// cs.rin.ru recent uploads are served by the Python backend (it owns the forum
// login + rinDark parsing). Reached server-to-server on the unpublished backend
// port with the shared internal key — same handoff the middleware uses.
const BACKEND_URL = (process.env.BACKEND_INTERNAL_URL || 'http://aiogames-backend:8000').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.INTERNAL_API_SECRET || '';

async function fetchCsrinRecentFromBackend(): Promise<Game[]> {
  if (!INTERNAL_KEY) return [];
  try {
    const res = await fetch(`${BACKEND_URL}/api/games/csrin-recent`, {
      headers: { 'x-aio-internal-key': INTERNAL_KEY },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[recent] backend csrin-recent returned ${res.status}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.results) ? (data.results as Game[]) : [];
  } catch (err) {
    console.warn('[recent] backend csrin-recent fetch failed:', err);
    return [];
  }
}

// csrin posts arrive with clean titles but no Steam AppID / cover image (the
// forum has neither). The home grid hides games without an AppID by default, so
// resolve AppID + IGDB cover here — synchronously, so csrin cards are complete
// on first paint instead of relying on the background pass that only enriches
// the Node cache. Cached alongside the backend's own 15-min window so repeat
// loads don't re-hit Steam/IGDB.
const CSRIN_ENRICH_TTL_MS = 15 * 60 * 1000;
let csrinEnrichCache: { results: Game[]; timestamp: number } | null = null;

async function enrichCsrinResults(posts: Game[]): Promise<Game[]> {
  if (posts.length === 0) return posts;
  if (csrinEnrichCache && Date.now() - csrinEnrichCache.timestamp < CSRIN_ENRICH_TTL_MS) {
    return csrinEnrichCache.results;
  }
  try {
    const titles = posts.map(p => (p.originalTitle || p.title || '') as string);
    const appIdMap = await resolveSteamAppIdsBatch(titles, 6);

    // Resolve IGDB covers with a small worker pool (not Promise.all): the feed
    // now scans many more threads, and firing 20+ IGDB requests at once trips
    // its rate limiter. Dedupe by clean title so repeated names resolve once.
    const cleanTitles = Array.from(new Set(
      posts
        .filter(p => !p.image)
        .map(p => cleanGameTitle((p.originalTitle || p.title || '') as string).trim())
        .filter(Boolean)
    ));
    const imageMap = new Map<string, string>();
    let cursor = 0;
    const IMAGE_CONCURRENCY = 3;
    await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, async () => {
      while (cursor < cleanTitles.length) {
        const clean = cleanTitles[cursor++];
        const img = await resolveIGDBImage(clean);
        if (img) imageMap.set(clean, img);
      }
    }));

    const enriched = posts.map((p) => {
      const rawTitle = (p.originalTitle || p.title || '') as string;
      const appId = appIdMap.get(rawTitle) || undefined;
      const image = (p.image as string | undefined)
        || imageMap.get(cleanGameTitle(rawTitle).trim())
        || undefined;
      return {
        ...p,
        ...(appId ? { appid: appId } : {}),
        ...(image ? { image } : {}),
      } as Game;
    });
    csrinEnrichCache = { results: enriched, timestamp: Date.now() };
    return enriched;
  } catch (err) {
    console.warn('[recent] csrin enrichment failed:', err);
    return posts;
  }
}

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
    // Site filter is a comma-separated list (?site=skidrow,steamrip).
    // Empty / missing / "all" returns every cached site. csrin is never
    // present in the recent cache (fetchRecentFromSite returns [] for it),
    // so the "default = exclude csrin" rule from search doesn't apply here.
    const rawSite = (searchParams.get('site') || '').trim();
    const siteList: string[] = rawSite && rawSite.toLowerCase() !== 'all'
      ? Array.from(new Set(
          rawSite.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        ))
      : [];
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
    if (siteList.length > 0) {
      const wanted = new Set(siteList);
      finalResults = results.filter((game: Game) => wanted.has(game.siteType));
    }

    // cs.rin.ru is never in the Node all-sites cache (fetchRecentFromSite skips
    // it). Its recent releases come from the Python backend, which logs into the
    // forum, scans the Game Releases subforum for link-bearing posts, and caches
    // for 15 min so repeat loads stay cheap. Show them in the default feed and
    // whenever csrin is explicitly selected — but not when the user has filtered
    // to other specific sites.
    if (siteList.length === 0 || siteList.includes('csrin')) {
      // Guard the total response time: on a cold miss the deeper csrin scan +
      // enrichment can be slow, and the reverse proxy will 504 the whole request
      // (skidrow included) if we block too long. Cap the csrin work at a budget;
      // if it overruns we return without csrin this time — the backend + enrich
      // caches keep warming in the background, so csrin shows on the next load.
      const csrinResults = await Promise.race([
        (async () => enrichCsrinResults(await fetchCsrinRecentFromBackend()))(),
        new Promise<Game[]>((resolve) => setTimeout(() => resolve([]), 35_000)),
      ]);
      if (csrinResults.length > 0) {
        finalResults = [...csrinResults, ...finalResults];
      }
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
      },
    });
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}
