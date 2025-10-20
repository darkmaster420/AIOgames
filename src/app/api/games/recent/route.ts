import { NextResponse, NextRequest } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';

// Simple in-memory cache (per server instance). For multi-instance you'd need Redis or KV.
let cachedRecent: { data: unknown; timestamp: number; siteKey: string } | null = null;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (extended from 1 hour)

// Export function to clear cache (can be called from other routes)
export function clearRecentGamesCache() {
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

    const now = Date.now();
    const cacheKey = 'all'; // we fetch all then filter locally
  let data: unknown;
    let isFromCache = false;

    if (cachedRecent && (now - cachedRecent.timestamp) < CACHE_TTL_MS && cachedRecent.siteKey === cacheKey) {
      data = cachedRecent.data;
      isFromCache = true;
    } else {
      const apiUrl = process.env.GAME_API_URL + '/recent' || 'https://gameapi.a7a8524.workers.dev/recent';
      const response = await fetch(apiUrl, { next: { revalidate: 0 }, cache: 'no-store' });
      if (!response.ok) {
        // Clear cache on API failure to prevent caching error responses
        cachedRecent = null;
        throw new Error(`API request failed: ${response.status}`);
      }
      data = await response.json();
      
      // Only cache if the response is valid
      const validationData = data as { success: boolean; results: unknown[] };
      if (validationData.success && validationData.results && Array.isArray(validationData.results)) {
        cachedRecent = { data, timestamp: now, siteKey: cacheKey };
      } else {
        // Don't cache invalid responses
        cachedRecent = null;
      }
    }

    // Extract the results array from the API response structure
    const apiData = data as { success: boolean; results: Game[] };
    if (apiData.success && apiData.results && Array.isArray(apiData.results)) {
      let results = apiData.results;
      
      // Add original titles and clean existing titles
      results = results.map((game: Game) => ({
        ...game,
        originalTitle: game.title, // Store the original title
        title: cleanGameTitle(game.title) // Clean the title
      }));
      
      // Apply local site filtering if a specific site is requested
      if (site && site !== 'all') {
        results = results.filter((game: Game) => game.siteType === site);
      }

      // Calculate cache age and remaining TTL for headers
      const cacheAge = isFromCache ? Math.floor((now - cachedRecent!.timestamp) / 1000) : 0;
      const remainingTTL = Math.max(0, Math.floor((CACHE_TTL_MS - (now - (cachedRecent?.timestamp || now))) / 1000));

      return NextResponse.json(results, {
        headers: {
          'Cache-Control': `public, max-age=${remainingTTL}, s-maxage=${remainingTTL}`,
          'X-Cache-Status': isFromCache ? 'HIT' : 'MISS',
          'X-Cache-Age': cacheAge.toString(),
          'X-Cache-TTL': remainingTTL.toString()
        }
      });
    } else {
      console.error('Invalid API response structure:', data);
      return NextResponse.json({ error: 'Invalid API response structure' }, { status: 500 });
    }
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}