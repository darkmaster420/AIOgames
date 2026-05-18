import { NextRequest, NextResponse } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';
import { filterGamesBySearchQuery } from '../../../../utils/searchQueryFilter';
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

interface SearchResponse {
  results: ApiGame[];
  // When a specific set of site filters was requested but returned no
  // results and we fell back to the default (all-minus-excluded) search,
  // this carries the originally-requested sites so the UI can surface a
  // "fell back" notice. Omitted otherwise.
  fallbackFromSites?: string[];
}

interface CacheEntry {
  data: SearchResponse;
  timestamp: number;
}

// Runs the full search-enrichment pipeline on a raw set of posts: clean
// titles, peek the AppID cache, batch-resolve missing AppIDs against Steam,
// swap CF-protected poster URLs for stable Steam headers, then apply the
// term filter. Pulled out so the fallback-to-all-sites path can re-run it
// without duplicating ~60 lines.
async function enrichSearchResults(rawResults: ApiGame[], searchQuery: string): Promise<ApiGame[]> {
  const seeded: ApiGame[] = rawResults.map((game: ApiGame) => {
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

  results = results.map((game) => {
    const appId = extractNativeAppId(game);
    if (!appId) return game;
    const currentImage = typeof game.image === 'string' ? game.image : '';
    const shouldUseSteamHeader = !currentImage || isCfProtectedUrl(currentImage);
    if (!shouldUseSteamHeader) return game;
    return { ...game, image: steamHeaderImageUrl(appId) };
  });

  const beforeTermFilter = results.length;
  results = filterGamesBySearchQuery(results, searchQuery);
  if (beforeTermFilter > results.length) {
    console.log(
      `[Search] Term filter removed ${beforeTermFilter - results.length} result(s) for "${searchQuery}"`
    );
  }

  return results;
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
    // Site filter is a comma-separated list (?site=skidrow,steamrip). Empty
    // / missing / "all" means "use the default set" (gameapi picks every
    // site except those in its DEFAULT_EXCLUDED_FROM_ALL list, which keeps
    // csrin off the wire unless the user explicitly opts in).
    const rawSite = (searchParams.get('site') || '').trim();
    const requestedSites: string[] = rawSite && rawSite.toLowerCase() !== 'all'
      ? Array.from(new Set(
          rawSite.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        ))
      : [];
    const noCache = ['1', 'true', 'yes'].includes((searchParams.get('nocache') || '').toLowerCase());

    if (!search) {
      return NextResponse.json({ error: 'Search query required' }, { status: 400 });
    }

    // Cache key is normalised + sorted so {skidrow,steamrip} and
    // {steamrip,skidrow} share an entry.
    const siteCacheKey = requestedSites.length
      ? [...requestedSites].sort().join(',')
      : 'all';
    const cacheKey = `${search.toLowerCase().trim()}:${siteCacheKey}`;
    
    // Check cache first
    const cached = noCache ? undefined : searchCache.get(cacheKey);
    if (!noCache && cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`[Search] Cache HIT for "${search}" (sites: ${siteCacheKey})`);
      return NextResponse.json(cached.data);
    }

    if (noCache) {
      console.log(`[Search] Cache BYPASS for "${search}" (sites: ${siteCacheKey}) - fetching fresh from API`);
    } else {
      console.log(`[Search] Cache MISS for "${search}" (sites: ${siteCacheKey}) - fetching from API`);
    }

    // Call gameapi directly (integrated module). Empty list = default
    // (gameapi will pick all sites minus DEFAULT_EXCLUDED_FROM_ALL).
    const data = await searchGames(search, requestedSites.length ? requestedSites : undefined);

    if (!data.success || !data.results || !Array.isArray(data.results)) {
      console.error('Invalid search API response structure:', data);
      return NextResponse.json({ error: 'Invalid search response structure' }, { status: 500 });
    }

    let results = await enrichSearchResults(data.results, search);
    let fallbackFromSites: string[] | undefined;

    // Fallback: when the user filtered to specific sites and that combined
    // set returned nothing useful (often happens with Skidrow's weak WP
    // search missing scene-format titles), automatically widen to the
    // default set so they still see results. UI surfaces a notice via
    // fallbackFromSites listing the empty selection.
    if (requestedSites.length > 0 && results.length === 0) {
      console.log(`[Search] "${search}" returned 0 from sites=${requestedSites.join(',')}, falling back to default`);
      const fallbackData = await searchGames(search);
      if (fallbackData.success && Array.isArray(fallbackData.results)) {
        const fallbackResults = await enrichSearchResults(fallbackData.results, search);
        if (fallbackResults.length > 0) {
          results = fallbackResults;
          fallbackFromSites = requestedSites;
        }
      }
    }

    const response: SearchResponse = fallbackFromSites
      ? { results, fallbackFromSites }
      : { results };

    searchCache.set(cacheKey, { data: response, timestamp: Date.now() });

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

    return NextResponse.json(response);
  } catch (error) {
    console.error('Search games error:', error);
    return NextResponse.json({ error: 'Failed to search games' }, { status: 500 });
  }
}