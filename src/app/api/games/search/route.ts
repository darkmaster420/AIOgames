import { NextRequest, NextResponse } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';
import { searchGames } from '../../../../lib/gameapi';
import { peekCachedSteamAppId, resolveSteamAppIdsBatch } from '../../../../utils/steamAppIdResolver';
import { isCfProtectedUrl, prefetchImageBatch } from '../../../../utils/imageCache';

interface ApiGame {
  id: string;
  title: string;
  source: string;
  siteType: string;
  appid?: number | string;
  appId?: number | string;
  steamAppId?: number | string;
  steam_appid?: number | string;
  originalTitle?: string;
  [key: string]: unknown;
}

function hasNativeAppId(game: ApiGame): boolean {
  const candidates = [game.appid, game.appId, game.steamAppId, game.steam_appid];
  return candidates.some(c => c !== undefined && c !== null && /^\d+$/.test(String(c).trim()));
}

function extractNativeAppId(game: ApiGame): string | null {
  const candidates = [game.appid, game.appId, game.steamAppId, game.steam_appid];
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const v = String(c).trim();
    if (/^\d+$/.test(v)) return v;
  }
  return null;
}

function steamHeaderImageUrl(appId: string): string {
  // shared.fastly domain is significantly more reliable than source-site
  // WordPress/Cloudflare media URLs for search-result posters.
  return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
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
    const noCache = ['1', 'true', 'yes'].includes((searchParams.get('nocache') || '').toLowerCase());

    if (!search) {
      return NextResponse.json({ error: 'Search query required' }, { status: 400 });
    }

    // Create cache key from search params
    const cacheKey = `${search.toLowerCase().trim()}:${site}`;
    
    // Check cache first
    const cached = noCache ? undefined : searchCache.get(cacheKey);
    if (!noCache && cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`[Search] Cache HIT for "${search}" (site: ${site})`);
      return NextResponse.json(cached.data);
    }

    if (noCache) {
      console.log(`[Search] Cache BYPASS for "${search}" (site: ${site}) - fetching fresh from API`);
    } else {
      console.log(`[Search] Cache MISS for "${search}" (site: ${site}) - fetching from API`);
    }

    // Call gameapi directly (integrated module)
    const data = await searchGames(search, site && site !== 'all' ? site : undefined);
    
    // Extract the results array from the API response structure
    if (data.success && data.results && Array.isArray(data.results)) {
      // Add original titles, clean existing titles, and seed any Steam
      // AppIDs we already have cached from prior runs.
      const seeded: ApiGame[] = data.results.map((game: ApiGame) => {
        const originalTitle = game.title;
        const next: ApiGame = {
          ...game,
          originalTitle,
          title: cleanGameTitle(game.title),
        };
        if (!hasNativeAppId(next)) {
          const cached = peekCachedSteamAppId(originalTitle);
          if (cached) next.appid = cached;
        }
        return next;
      });

      // Fill in AppIDs for any games that don't have one yet. Since search
      // responses are much smaller than the recent feed (usually <=20 items),
      // we resolve synchronously so the client gets a fully-verified result
      // set in a single response.
      const needsResolution = seeded.filter(g => !hasNativeAppId(g));
      let results: ApiGame[] = seeded;
      if (needsResolution.length > 0) {
        try {
          const titles = needsResolution.map(g => (g.originalTitle || g.title || '') as string);
          const resolvedMap = await resolveSteamAppIdsBatch(titles, 6);
          results = seeded.map(game => {
            if (hasNativeAppId(game)) return game;
            const raw = (game.originalTitle || game.title || '') as string;
            const appId = resolvedMap.get(raw);
            return appId ? { ...game, appid: appId } : game;
          });
        } catch (err) {
          console.warn('[Search] AppID resolution failed, returning unresolved results:', err);
        }
      }

      // Image reliability pass for search:
      // - If a result has an AppID and no image, use Steam header directly.
      // - If current image host is CF-protected/flaky, prefer Steam header.
      // This avoids routing large portions of search posters through
      // FlareSolverr-dependent hosts.
      results = results.map((game) => {
        const appId = extractNativeAppId(game);
        if (!appId) return game;
        const currentImage = typeof game.image === 'string' ? game.image : '';
        const shouldUseSteamHeader =
          !currentImage ||
          isCfProtectedUrl(currentImage);
        if (!shouldUseSteamHeader) return game;
        return { ...game, image: steamHeaderImageUrl(appId) };
      });

      searchCache.set(cacheKey, {
        data: results,
        timestamp: Date.now()
      });

      // Warm the server-side image byte cache in the background so the
      // browser's follow-up /api/proxy-image requests are memory hits. Fire
      // and forget — never blocks the response.
      const imageUrls = results
        .map(g => (typeof g.image === 'string' ? g.image : ''))
        .filter(Boolean) as string[];
      if (imageUrls.length > 0) {
        prefetchImageBatch(imageUrls, 3).catch(err => {
          console.warn('[Search] Image prefetch failed:', err);
        });
      }

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