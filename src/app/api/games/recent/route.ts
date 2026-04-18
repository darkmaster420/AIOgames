import { NextResponse, NextRequest } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';
import { resolveIGDBImage } from '../../../../utils/igdb';
import { getRecentUploads } from '../../../../lib/gameapi';

// Simple in-memory cache — stores fully enriched results (with IGDB images)
let cachedRecent: { results: Game[]; timestamp: number; siteKey: string } | null = null;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Track titles that failed both IGDB and RAWG — don't retry until cache expires
const failedImageTitles = new Set<string>();

// Internal function to clear cache (exported for potential future use)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function clearRecentGamesCache() {
  cachedRecent = null;
}

interface Game {
  siteType: string;
  id: string;
  title: string;
  originalTitle?: string;
  source: string;
  [key: string]: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const site = searchParams.get('site') || 'all';
    const forceRefresh = searchParams.get('refresh') === 'true';

    const now = Date.now();
    const cacheKey = 'all';
    let enrichedResults: Game[];
    let isFromCache = false;

    if (!forceRefresh && cachedRecent && (now - cachedRecent.timestamp) < CACHE_TTL_MS && cachedRecent.siteKey === cacheKey) {
      enrichedResults = cachedRecent.results;
      isFromCache = true;

      // Re-try for any games still missing images, skipping titles that already failed both IGDB+RAWG
      const stillNeedImages = enrichedResults.filter((g: Game) => {
        if (g.image) return false;
        const searchTitle = (g.title as string).trim();
        return searchTitle && !failedImageTitles.has(searchTitle.toLowerCase());
      });
      if (stillNeedImages.length > 0) {
        console.log(`[Recent] Cache hit but ${stillNeedImages.length} games still need images, retrying...`);
        const imageMap = new Map<string, string>();
        for (const game of stillNeedImages) {
          const searchTitle = (game.title as string).trim();
          if (!searchTitle || imageMap.has(searchTitle)) continue;
          const image = await resolveIGDBImage(searchTitle);
          if (image) {
            imageMap.set(searchTitle, image);
          } else {
            // Both IGDB and RAWG failed — stop retrying this title until fresh data
            failedImageTitles.add(searchTitle.toLowerCase());
          }
          await new Promise(r => setTimeout(r, 300));
        }
        if (imageMap.size > 0) {
          console.log(`[Recent] Re-enrichment resolved ${imageMap.size} new images`);
          enrichedResults = enrichedResults.map((game: Game) => {
            if (!game.image) {
              const searchTitle = (game.title as string).trim();
              const igdbImage = imageMap.get(searchTitle);
              if (igdbImage) return { ...game, image: igdbImage } as Game;
            }
            return game;
          });
          cachedRecent = { results: enrichedResults, timestamp: cachedRecent!.timestamp, siteKey: cacheKey };
        }
      }
    } else {
      const data = await getRecentUploads();
      
      if (!data.success || !data.results || !Array.isArray(data.results)) {
        cachedRecent = null;
        console.error('Invalid API response structure:', data);
        return NextResponse.json({ error: 'Invalid API response structure' }, { status: 500 });
      }

      // Clean titles
      const results = data.results.map((game: Game) => ({
        ...game,
        originalTitle: game.title,
        title: cleanGameTitle(game.title)
      }));

      // Enrich games that have no image with IGDB covers (sequential with delay to respect rate limits)
      const gamesNeedingImages = results.filter((g: Game) => !g.image);
      console.log(`[Recent] Enriching ${gamesNeedingImages.length}/${results.length} games with IGDB images...`);
      
      const imageMap = new Map<string, string>();
      for (const game of gamesNeedingImages) {
        // Use the cleaned title for image searches
        const searchTitle = (game.title as string).trim();
        if (!searchTitle) continue;
        
        // Skip if we already resolved this title
        if (imageMap.has(searchTitle)) continue;

        const igdbImage = await resolveIGDBImage(searchTitle);
        if (igdbImage) {
          imageMap.set(searchTitle, igdbImage);
        }

        // 300ms delay between requests to stay under IGDB rate limit (4 req/sec)
        await new Promise(r => setTimeout(r, 300));
      }

      // Apply resolved images
      enrichedResults = results.map((game: Game) => {
        if (!game.image) {
          const searchTitle = (game.title as string).trim();
          const igdbImage = imageMap.get(searchTitle);
          if (igdbImage) {
            return { ...game, image: igdbImage } as Game;
          }
        }
        return game;
      });

      console.log(`[Recent] IGDB enrichment done: ${imageMap.size} images resolved`);

      // Reset failed titles on fresh data fetch
      failedImageTitles.clear();

      // Cache the fully enriched results
      cachedRecent = { results: enrichedResults, timestamp: now, siteKey: cacheKey };
    }

    // Apply local site filtering
    let finalResults = enrichedResults;
    if (site && site !== 'all') {
      finalResults = enrichedResults.filter((game: Game) => game.siteType === site);
    }

    const cacheAge = isFromCache ? Math.floor((now - cachedRecent!.timestamp) / 1000) : 0;
    const remainingTTL = Math.max(0, Math.floor((CACHE_TTL_MS - (now - (cachedRecent?.timestamp || now))) / 1000));

    return NextResponse.json(finalResults, {
      headers: {
        'Cache-Control': `public, max-age=${remainingTTL}, s-maxage=${remainingTTL}`,
        'X-Cache-Status': isFromCache ? 'HIT' : 'MISS',
        'X-Cache-Age': cacheAge.toString(),
        'X-Cache-TTL': remainingTTL.toString()
      }
    });
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}