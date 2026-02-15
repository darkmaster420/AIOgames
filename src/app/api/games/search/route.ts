import { NextRequest, NextResponse } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';

interface ApiGame {
  id: string;
  title: string;
  source: string;
  siteType: string;
  [key: string]: unknown;
}

interface CacheEntry {
  data: ApiGame[];
  timestamp: number;
}

// In-memory cache with 10-minute TTL
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Clean up old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of searchCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}, 60 * 1000); // Run every minute

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const site = searchParams.get('site') || 'all';

    if (!search) {
      return NextResponse.json({ error: 'Search query required' }, { status: 400 });
    }

    // Create cache key from search params
    const cacheKey = `${search.toLowerCase().trim()}:${site}`;
    
    // Check cache first
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`[Search] Cache HIT for "${search}" (site: ${site})`);
      return NextResponse.json(cached.data);
    }

    console.log(`[Search] Cache MISS for "${search}" (site: ${site}) - fetching from API`);

    // Build query parameters for the external API - it supports site filtering for search
    const queryParams = new URLSearchParams({ search });
    if (site && site !== 'all') {
      queryParams.set('site', site);
    }
    
    const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
    const response = await fetch(`${baseUrl}/?${queryParams}`);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract the results array from the API response structure
    if (data.success && data.results && Array.isArray(data.results)) {
      // Add original titles and clean existing titles
      const results = data.results.map((game: ApiGame) => ({
        ...game,
        originalId: game.id, // Map id to originalId for download links
        originalTitle: game.title, // Store the original title
        title: cleanGameTitle(game.title) // Clean the title
      }));
      
      // Store in cache
      searchCache.set(cacheKey, {
        data: results,
        timestamp: Date.now()
      });
      
      return NextResponse.json(results);
    } else {
      console.error('Invalid search API response structure:', data);
      return NextResponse.json({ error: 'Invalid search response structure' }, { status: 500 });
    }
  } catch (error) {
    console.error('Search games error:', error);
    return NextResponse.json({ error: 'Failed to search games' }, { status: 500 });
  }
}