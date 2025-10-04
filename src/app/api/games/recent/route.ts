import { NextResponse, NextRequest } from 'next/server';

// Simple in-memory cache (per server instance). For multi-instance you'd need Redis or KV.
let cachedRecent: { data: unknown; timestamp: number; siteKey: string } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface Game {
  siteType: string;
  id: string;
  title: string;
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

    if (cachedRecent && (now - cachedRecent.timestamp) < CACHE_TTL_MS && cachedRecent.siteKey === cacheKey) {
      data = cachedRecent.data;
    } else {
      const apiUrl = process.env.GAME_API_URL + '/recent' || 'https://gameapi.a7a8524.workers.dev/recent';
      const response = await fetch(apiUrl, { next: { revalidate: 0 }, cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      data = await response.json();
      cachedRecent = { data, timestamp: now, siteKey: cacheKey };
    }

    // Extract the results array from the API response structure
    const apiData = data as { success: boolean; results: Game[] };
    if (apiData.success && apiData.results && Array.isArray(apiData.results)) {
      let results = apiData.results;
      // Apply local site filtering if a specific site is requested
      if (site && site !== 'all') {
        results = results.filter((game: Game) => game.siteType === site);
      }
      return NextResponse.json(results);
    } else {
      console.error('Invalid API response structure:', data);
      return NextResponse.json({ error: 'Invalid API response structure' }, { status: 500 });
    }
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}