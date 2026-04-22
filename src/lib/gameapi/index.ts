/**
 * Game API - Integrated module (formerly separate gameapi service)
 * Provides search, recent uploads, post details, and cache management
 * as direct function calls instead of HTTP requests.
 */

// Side-effect import: installs the undici global dispatcher with a 60s+
// TCP connect timeout before any raw `fetch()` runs against the external
// sites. This replaces the undici default (10s) that was causing
// `UND_ERR_CONNECT_TIMEOUT` whenever a piracy/release site was slow to
// accept a TLS connection.
import './net';

import {
  SITE_CONFIGS as _SITE_CONFIGS,
  MAX_POSTS_PER_SITE as _MAX_POSTS_PER_SITE,
  fetchSteamrip,
  fetchSkidrow,
  fetchDodi,
  transformPostForV2,
  isValidImageUrl,
  fetchGogGamesRecent,
  transformGogGamesPost,
  fetchOnlineFixRecent,
  fetchOnlineFixSearch,
  siteFetch,
} from './helpers.js';

// Cast JS module exports to proper types
const SITE_CONFIGS = _SITE_CONFIGS as Record<string, SiteConfig>;
const MAX_POSTS_PER_SITE = _MAX_POSTS_PER_SITE as Record<string, number>;

// ─── Types ──────────────────────────────────────────────────────────────────

interface SiteConfig {
  baseUrl: string;
  type: string;
  name: string;
}

interface TransformedPost {
  id: string;
  originalId: number | string;
  title: string;
  excerpt: string;
  link: string;
  date: string;
  slug: string;
  description: string;
  categories: number[];
  tags: number[];
  downloadLinks: DownloadLink[];
  source: string;
  siteType: string;
  image: string | null;
  [key: string]: unknown;
}

interface DownloadLink {
  type: string;
  service: string;
  url: string;
  text?: string;
  label?: string;
  isTorrent?: boolean;
}

interface SearchResult {
  success: boolean;
  results: TransformedPost[];
  count: number;
  site?: string;
  cached?: boolean;
}

interface RecentResult {
  success: boolean;
  results: TransformedPost[];
  count: number;
  sitesAttempted: number;
  sitesSucceeded: number;
}

interface PostResult {
  success: boolean;
  post?: TransformedPost;
  cached: boolean;
  error?: string;
}

// ─── Search Cache ───────────────────────────────────────────────────────────

const searchCache = new Map<string, { results: TransformedPost[]; timestamp: number }>();
const SEARCH_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function searchSite(siteConfig: SiteConfig, searchQuery: string): Promise<TransformedPost[]> {
  try {
    if (siteConfig.type === 'goggames') {
      return [];
    }

    if (siteConfig.type === 'onlinefix') {
      return await fetchOnlineFixSearch(searchQuery);
    }

    const params = new URLSearchParams({
      search: searchQuery,
      orderby: 'date',
      order: 'desc'
    });

    if (siteConfig.type === 'gamedrive') {
      params.set('categories', '3');
    }

    if (siteConfig.type !== 'freegog') {
      const maxPosts = MAX_POSTS_PER_SITE[siteConfig.type] || MAX_POSTS_PER_SITE.default;
      params.set('per_page', maxPosts.toString());
    }

    const url = `${siteConfig.baseUrl}?${params}`;

    let response;
    if (siteConfig.type === 'steamrip') {
      response = await fetchSteamrip(url);
    } else if (siteConfig.type === 'skidrow') {
      response = await fetchSkidrow(url);
    } else if (siteConfig.type === 'dodi') {
      response = await fetchDodi(url);
    } else {
      response = await siteFetch(url, {
        headers: { 'User-Agent': 'GameSearch-API-v2/2.0' }
      });
    }

    if (!response || !response.ok) {
      console.error(`${siteConfig.name} returned ${response?.status || 'no response'}`);
      return [];
    }

    const posts = await response.json();
    const transformPromises = posts.map((post: unknown) => transformPostForV2(post, siteConfig, false));
    return await Promise.all(transformPromises);
  } catch (error) {
    console.error(`Error searching ${siteConfig.name}:`, error);
    return [];
  }
}

async function fetchRecentFromSite(siteConfig: SiteConfig): Promise<TransformedPost[]> {
  try {
    if (siteConfig.type === 'goggames') {
      const items = await fetchGogGamesRecent();
      return items.map((item: unknown) => transformGogGamesPost(item));
    }

    if (siteConfig.type === 'onlinefix') {
      return await fetchOnlineFixRecent();
    }

    const params = new URLSearchParams({
      orderby: 'date',
      order: 'desc'
    });

    if (siteConfig.type === 'gamedrive') {
      params.set('categories', '3');
    }

    if (siteConfig.type !== 'freegog') {
      const maxPosts = MAX_POSTS_PER_SITE[siteConfig.type] || MAX_POSTS_PER_SITE.default;
      params.set('per_page', maxPosts.toString());
      params.set('page', '1');
    }

    const url = `${siteConfig.baseUrl}?${params}`;

    let response;
    if (siteConfig.type === 'steamrip') {
      response = await fetchSteamrip(url);
    } else if (siteConfig.type === 'skidrow') {
      response = await fetchSkidrow(url);
    } else if (siteConfig.type === 'dodi') {
      response = await fetchDodi(url);
    } else {
      response = await siteFetch(url, {
        headers: { 'User-Agent': 'GameSearch-API-v2/2.0' }
      });
    }

    if (!response || !response.ok) {
      return [];
    }

    const posts = await response.json();
    const transformPromises = posts.map((post: unknown) => transformPostForV2(post, siteConfig, false));
    return await Promise.all(transformPromises);
  } catch (error) {
    console.error(`Error fetching recent from ${siteConfig.name}:`, error);
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Search games across all sites or a specific site.
 */
export async function searchGames(query: string, site?: string): Promise<SearchResult> {
  if (!query) {
    return { success: false, results: [], count: 0 };
  }

  // Single-site search
  if (site) {
    const siteConfig = SITE_CONFIGS[site] as SiteConfig | undefined;
    if (!siteConfig) {
      return { success: false, results: [], count: 0 };
    }

    const results = await searchSite(siteConfig, query);
    const cacheKey = `${site}:${query.toLowerCase()}`;

    if (results.length > 0) {
      searchCache.set(cacheKey, { results, timestamp: Date.now() });
    } else {
      // Retry once, then fallback to cache
      console.warn(`Single-site search for ${site} returned empty, retrying`);
      const retryResults = await searchSite(siteConfig, query);
      if (retryResults.length > 0) {
        searchCache.set(cacheKey, { results: retryResults, timestamp: Date.now() });
        return { success: true, results: retryResults, count: retryResults.length, site };
      }
      const cached = searchCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL) {
        console.log(`Using cached results for ${site}`);
        return { success: true, results: cached.results, count: cached.results.length, site, cached: true };
      }
    }

    return { success: true, results, count: results.length, site };
  }

  // All-sites search
  const allSites = Object.values(SITE_CONFIGS) as SiteConfig[];
  const searchPromises = allSites.map(s => searchSite(s, query));
  const settledResults = await Promise.allSettled(searchPromises);

  const combinedResults: TransformedPost[] = [];
  const failedSites: { site: SiteConfig; cacheKey: string }[] = [];

  settledResults.forEach((result, index) => {
    const s = allSites[index];
    const cacheKey = `${s.type}:${query.toLowerCase()}`;

    if (result.status === 'fulfilled' && result.value.length > 0) {
      searchCache.set(cacheKey, { results: result.value, timestamp: Date.now() });
      combinedResults.push(...result.value);
    } else {
      const reason = result.status === 'rejected' ? result.reason : 'empty results';
      console.warn(`Search returned nothing for ${s.name}: ${reason}`);
      failedSites.push({ site: s, cacheKey });
    }
  });

  // Retry failed/empty sites once
  if (failedSites.length > 0) {
    const retryPromises = failedSites.map(({ site: s }) => searchSite(s, query));
    const retryResults = await Promise.allSettled(retryPromises);

    retryResults.forEach((result, index) => {
      const { site: s, cacheKey } = failedSites[index];

      if (result.status === 'fulfilled' && result.value.length > 0) {
        console.log(`Retry succeeded for ${s.name}: ${result.value.length} results`);
        searchCache.set(cacheKey, { results: result.value, timestamp: Date.now() });
        combinedResults.push(...result.value);
      } else {
        const cached = searchCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL) {
          console.log(`Using cached results for ${s.name} (${cached.results.length} results, age ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
          combinedResults.push(...cached.results);
        } else {
          console.warn(`No cached results available for ${s.name}`);
        }
      }
    });
  }

  return { success: true, results: combinedResults, count: combinedResults.length };
}

/**
 * Fetch recent uploads from all sites.
 */
export async function getRecentUploads(): Promise<RecentResult> {
  const allSites = Object.values(SITE_CONFIGS) as SiteConfig[];

  console.log(`Fetching recent uploads from ${allSites.length} sites`);

  const fetchPromises = allSites.map(s => fetchRecentFromSite(s));
  const allResults = await Promise.allSettled(fetchPromises);

  const combinedResults = allResults
    .filter((result): result is PromiseFulfilledResult<TransformedPost[]> => result.status === 'fulfilled')
    .flatMap(result => result.value);

  allResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Failed to fetch from ${allSites[index].name}:`, result.reason);
    }
  });

  combinedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    success: true,
    results: combinedResults,
    count: combinedResults.length,
    sitesAttempted: allSites.length,
    sitesSucceeded: allResults.filter(r => r.status === 'fulfilled').length
  };
}

/**
 * Fetch recent uploads from a single site. Used by the per-site refresh
 * endpoint and the auto-recovery logic in /api/games/recent that detects
 * empty/stale sites and refreshes just those without a full bulk rescrape.
 *
 * Returns the (possibly empty) posts array from that one site. Does not
 * touch any in-memory cache on its own — the caller is responsible for
 * merging the fresh results back into whatever cache it owns.
 */
export async function getRecentUploadsForSite(
  siteKey: string
): Promise<{ success: boolean; site: string; results: TransformedPost[]; count: number; error?: string }> {
  const siteConfig = SITE_CONFIGS[siteKey] as SiteConfig | undefined;
  if (!siteConfig) {
    return { success: false, site: siteKey, results: [], count: 0, error: `Invalid site: ${siteKey}` };
  }

  try {
    const results = await fetchRecentFromSite(siteConfig);
    return { success: true, site: siteKey, results, count: results.length };
  } catch (error) {
    console.error(`Error fetching recent from ${siteConfig.name}:`, error);
    return {
      success: false,
      site: siteKey,
      results: [],
      count: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List of site keys the gameapi knows about. Exposed so callers (like the
 * /api/games/recent auto-refresh logic) can iterate over every site without
 * hard-coding the list here.
 */
export function listSiteKeys(): string[] {
  return Object.keys(SITE_CONFIGS);
}

/**
 * Lookup the human-readable `name` for a site key, or `null` if unknown.
 */
export function getSiteDisplayName(siteKey: string): string | null {
  const siteConfig = SITE_CONFIGS[siteKey] as SiteConfig | undefined;
  return siteConfig?.name ?? null;
}

/**
 * Fetch details and download links for a specific post.
 */
export async function getPostDetails(postId: string, site: string): Promise<PostResult> {
  const siteConfig = SITE_CONFIGS[site] as SiteConfig | undefined;
  if (!siteConfig) {
    return { success: false, cached: false, error: `Invalid site: ${site}` };
  }

  try {
    let response;

    if (siteConfig.type === 'steamrip') {
      const postUrl = `${siteConfig.baseUrl}/${postId}`;
      console.log(`Fetching SteamRip post from API: ${postUrl}`);
      response = await fetchSteamrip(postUrl);
    } else {
      const postUrl = `${siteConfig.baseUrl}/${postId}`;
      console.log(`Fetching post details from: ${postUrl}`);

      if (siteConfig.type === 'skidrow') {
        response = await fetchSkidrow(postUrl);
      } else if (siteConfig.type === 'dodi') {
        response = await fetchDodi(postUrl);
      } else {
        response = await siteFetch(postUrl, {
          headers: { 'User-Agent': 'Game-Search-API-v2/2.0' }
        });
      }
    }

    if (!response || !response.ok) {
      return {
        success: false,
        cached: false,
        error: `${siteConfig.name} API returned ${response?.status || 'no response'}: ${response?.statusText || 'fetch failed'}`
      };
    }

    const post = await response.json();
    const transformedPost = await transformPostForV2(post, siteConfig, true);

    return { success: true, post: transformedPost, cached: false };
  } catch (error) {
    console.error('Error fetching post details:', error);
    return {
      success: false,
      cached: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Clear the in-memory search cache.
 */
export function clearGameApiCache(): void {
  searchCache.clear();
  console.log('GameAPI search cache cleared');
}

// Re-export isValidImageUrl for use in proxy-image route
export { isValidImageUrl };
