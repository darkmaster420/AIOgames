import { NextResponse, NextRequest } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';
import { resolveIGDBImage } from '../../../../utils/igdb';
import { getRecentUploads } from '../../../../lib/gameapi';

// Allow up to 2 minutes for initial data fetch (scraping multiple sites via FlareSolverr)
export const maxDuration = 120;

// Simple in-memory cache — stores results (progressively enriched with IGDB images)
let cachedRecent: { results: Game[]; timestamp: number; siteKey: string } | null = null;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Track titles that failed both IGDB and RAWG — don't retry until cache expires
const failedImageTitles = new Set<string>();

// Track whether background enrichment is already running
let enrichmentRunning = false;

interface Game {
  siteType: string;
  id: string;
  title: string;
  originalTitle?: string;
  source: string;
  [key: string]: unknown;
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
      enrichInBackground();
    } else {
      const data = await getRecentUploads();
      
      if (!data.success || !data.results || !Array.isArray(data.results)) {
        cachedRecent = null;
        console.error('Invalid API response structure:', data);
        return NextResponse.json({ error: 'Invalid API response structure' }, { status: 500 });
      }

      // Clean titles — return immediately, don't wait for image enrichment
      results = data.results.map((game: Game) => ({
        ...game,
        originalTitle: game.title,
        title: cleanGameTitle(game.title)
      }));

      // Reset failed titles on fresh data fetch
      failedImageTitles.clear();

      // Cache results immediately (without images) so they're available fast
      cachedRecent = { results, timestamp: now, siteKey: cacheKey };

      // Kick off background enrichment — images will be in cache for next request
      enrichInBackground();
    }

    // Apply local site filtering
    let finalResults = results;
    if (site && site !== 'all') {
      finalResults = results.filter((game: Game) => game.siteType === site);
    }

    const cacheAge = isFromCache ? Math.floor((now - cachedRecent!.timestamp) / 1000) : 0;
    const remainingTTL = Math.max(0, Math.floor((CACHE_TTL_MS - (now - (cachedRecent?.timestamp || now))) / 1000));
    const pendingImages = results.filter((g: Game) => !g.image).length;

    return NextResponse.json(finalResults, {
      headers: {
        // Browser-side caching disabled — server in-memory cache is the only cache.
        'Cache-Control': 'no-store, must-revalidate',
        'X-Cache-Status': isFromCache ? 'HIT' : 'MISS',
        'X-Cache-Age': cacheAge.toString(),
        'X-Cache-TTL': remainingTTL.toString(),
        'X-Pending-Images': pendingImages.toString()
      }
    });
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}