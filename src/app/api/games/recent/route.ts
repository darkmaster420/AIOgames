import { NextResponse, NextRequest } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';
import { resolveIGDBImage } from '../../../../utils/igdb';
import { getRecentUploads } from '../../../../lib/gameapi';
import { peekCachedSteamAppId, resolveSteamAppIdsBatch } from '../../../../utils/steamAppIdResolver';
import { prefetchImageBatch, getCachedImage } from '../../../../utils/imageCache';

// Allow up to 2 minutes for initial data fetch (scraping multiple sites via FlareSolverr)
export const maxDuration = 120;

// Simple in-memory cache — stores results (progressively enriched with IGDB images)
let cachedRecent: { results: Game[]; timestamp: number; siteKey: string } | null = null;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Track titles that failed both IGDB and RAWG — don't retry until cache expires
const failedImageTitles = new Set<string>();

// Track whether background enrichment is already running
let enrichmentRunning = false;
let appIdEnrichmentRunning = false;
let imagePrefetchRunning = false;

// Titles we've already tried to resolve and failed — don't re-hit Steam for
// them until the fresh-scrape cache expires.
const failedAppIdTitles = new Set<string>();

interface Game {
  siteType: string;
  id: string;
  title: string;
  originalTitle?: string;
  source: string;
  appid?: number | string;
  appId?: number | string;
  steamAppId?: number | string;
  steam_appid?: number | string;
  [key: string]: unknown;
}

function hasNativeAppId(game: Game): boolean {
  const candidates = [game.appid, game.appId, game.steamAppId, game.steam_appid];
  return candidates.some(c => c !== undefined && c !== null && /^\d+$/.test(String(c).trim()));
}

// Background enrichment — runs after response is sent, updates cache in-place
function enrichInBackground() {
  if (enrichmentRunning || !cachedRecent) return;

  const gamesNeedingImages = cachedRecent.results.filter((g: Game) => {
    if (g.image) return false;
    const searchTitle = (g.title as string).trim();
    return searchTitle && !failedImageTitles.has(searchTitle.toLowerCase());
  });

  if (gamesNeedingImages.length === 0) return;

  enrichmentRunning = true;
  console.log(`[Recent] Background enrichment starting for ${gamesNeedingImages.length} games...`);

  // Fire-and-forget async enrichment
  (async () => {
    try {
      const imageMap = new Map<string, string>();
      for (const game of gamesNeedingImages) {
        const searchTitle = (game.title as string).trim();
        if (!searchTitle || imageMap.has(searchTitle)) continue;

        const image = await resolveIGDBImage(searchTitle);
        if (image) {
          imageMap.set(searchTitle, image);
        } else {
          failedImageTitles.add(searchTitle.toLowerCase());
        }
        // 300ms delay between requests to stay under IGDB rate limit
        await new Promise(r => setTimeout(r, 300));
      }

      if (imageMap.size > 0 && cachedRecent) {
        cachedRecent.results = cachedRecent.results.map((game: Game) => {
          if (!game.image) {
            const searchTitle = (game.title as string).trim();
            const igdbImage = imageMap.get(searchTitle);
            if (igdbImage) return { ...game, image: igdbImage } as Game;
          }
          return game;
        });
        console.log(`[Recent] Background enrichment done: ${imageMap.size} images resolved`);
      } else {
        console.log(`[Recent] Background enrichment done: no new images`);
      }
    } catch (error) {
      console.error('[Recent] Background enrichment error:', error);
    } finally {
      enrichmentRunning = false;
      // Now that new image URLs have been slotted in, warm the byte cache
      // for them too.
      prefetchImageBytesInBackground();
    }
  })();
}

// Background image-byte prefetch — downloads the actual image bytes for every
// game that has an `image` URL and caches them in memory so the browser's
// /api/proxy-image requests become near-instant memory hits. This is what
// stops the browser from having to sit through N FlareSolverr-backed
// Cloudflare fetches itself.
function prefetchImageBytesInBackground() {
  if (imagePrefetchRunning || !cachedRecent) return;

  const urls: string[] = [];
  for (const g of cachedRecent.results) {
    const url = g.image;
    if (typeof url !== 'string' || !url) continue;
    if (getCachedImage(url)) continue;
    urls.push(url);
  }
  if (urls.length === 0) return;

  imagePrefetchRunning = true;
  console.log(`[Recent] Background image-byte prefetch starting for ${urls.length} images...`);

  (async () => {
    try {
      const cachedCount = await prefetchImageBatch(urls, 3);
      console.log(`[Recent] Background image-byte prefetch done: ${cachedCount}/${urls.length} cached`);
    } catch (error) {
      console.error('[Recent] Background image-byte prefetch error:', error);
    } finally {
      imagePrefetchRunning = false;
    }
  })();
}

// Background AppID enrichment — runs after response is sent, fills in Steam
// AppIDs for any games that didn't have one embedded and aren't already
// resolved in the resolver cache. Updates cachedRecent.results in-place so
// subsequent requests return fully-verified data without the client having to
// do any Steam calls itself.
function enrichAppIdsInBackground() {
  if (appIdEnrichmentRunning || !cachedRecent) return;

  const gamesNeedingAppId = cachedRecent.results.filter((g: Game) => {
    if (hasNativeAppId(g)) return false;
    const cleanTitle = cleanGameTitle(g.originalTitle || g.title || '').trim();
    if (!cleanTitle) return false;
    return !failedAppIdTitles.has(cleanTitle.toLowerCase());
  });

  if (gamesNeedingAppId.length === 0) return;

  appIdEnrichmentRunning = true;
  console.log(`[Recent] Background AppID enrichment starting for ${gamesNeedingAppId.length} games...`);

  (async () => {
    try {
      const titles = gamesNeedingAppId.map(g => (g.originalTitle || g.title || '') as string);
      const resolvedMap = await resolveSteamAppIdsBatch(titles, 6);

      let resolvedCount = 0;
      if (cachedRecent) {
        cachedRecent.results = cachedRecent.results.map((game: Game) => {
          if (hasNativeAppId(game)) return game;
          const rawTitle = (game.originalTitle || game.title || '') as string;
          const appId = resolvedMap.get(rawTitle);
          if (appId) {
            resolvedCount++;
            return { ...game, appid: appId } as Game;
          }
          const cleanTitle = cleanGameTitle(rawTitle).trim();
          if (cleanTitle) failedAppIdTitles.add(cleanTitle.toLowerCase());
          return game;
        });
      }
      console.log(`[Recent] Background AppID enrichment done: ${resolvedCount} resolved`);
    } catch (error) {
      console.error('[Recent] Background AppID enrichment error:', error);
    } finally {
      appIdEnrichmentRunning = false;
    }
  })();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const site = searchParams.get('site') || 'all';
    const forceRefresh = searchParams.get('refresh') === 'true';

    const now = Date.now();
    const cacheKey = 'all';
    let results: Game[];
    let isFromCache = false;

    if (!forceRefresh && cachedRecent && (now - cachedRecent.timestamp) < CACHE_TTL_MS && cachedRecent.siteKey === cacheKey) {
      results = cachedRecent.results;
      isFromCache = true;

      // Kick off background re-enrichment for any games still missing images
      // or Steam AppIDs, and warm the image byte cache for anything that's
      // not already resident. All update the cache in-place.
      enrichInBackground();
      enrichAppIdsInBackground();
      prefetchImageBytesInBackground();
    } else {
      const data = await getRecentUploads();
      
      if (!data.success || !data.results || !Array.isArray(data.results)) {
        cachedRecent = null;
        console.error('Invalid API response structure:', data);
        return NextResponse.json({ error: 'Invalid API response structure' }, { status: 500 });
      }

      // Clean titles and seed any Steam AppIDs we already have cached from a
      // previous run. This means a fresh scrape still returns with many games
      // already verified (provided they've been seen before) — no client work
      // required.
      results = data.results.map((game: Game) => {
        const originalTitle = game.title;
        const cleanedTitle = cleanGameTitle(game.title);
        const next: Game = {
          ...game,
          originalTitle,
          title: cleanedTitle,
        };
        if (!hasNativeAppId(next)) {
          const cached = peekCachedSteamAppId(originalTitle);
          if (cached) next.appid = cached;
        }
        return next;
      });

      // Reset failure sets on fresh data fetch so previously-failed titles
      // get another attempt.
      failedImageTitles.clear();
      failedAppIdTitles.clear();

      // Cache results immediately so they're available fast
      cachedRecent = { results, timestamp: now, siteKey: cacheKey };

      // Kick off background enrichment — images and AppIDs will be in cache
      // for the next request, plus pre-download the raw image bytes so the
      // user's browser gets instant memory hits from /api/proxy-image.
      enrichInBackground();
      enrichAppIdsInBackground();
      prefetchImageBytesInBackground();
    }

    // Apply local site filtering
    let finalResults = results;
    if (site && site !== 'all') {
      finalResults = results.filter((game: Game) => game.siteType === site);
    }

    const cacheAge = isFromCache ? Math.floor((now - cachedRecent!.timestamp) / 1000) : 0;
    const remainingTTL = Math.max(0, Math.floor((CACHE_TTL_MS - (now - (cachedRecent?.timestamp || now))) / 1000));
    const pendingImages = results.filter((g: Game) => !g.image).length;
    const pendingAppIds = results.filter((g: Game) => !hasNativeAppId(g)).length;

    return NextResponse.json(finalResults, {
      headers: {
        // Browser-side caching disabled — server in-memory cache is the only cache.
        'Cache-Control': 'no-store, must-revalidate',
        'X-Cache-Status': isFromCache ? 'HIT' : 'MISS',
        'X-Cache-Age': cacheAge.toString(),
        'X-Cache-TTL': remainingTTL.toString(),
        'X-Pending-Images': pendingImages.toString(),
        'X-Pending-AppIds': pendingAppIds.toString()
      }
    });
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}