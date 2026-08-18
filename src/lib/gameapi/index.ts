/**
 * Game API - Integrated module (formerly separate gameapi service)
 * Provides search, recent uploads, post details, and cache management
 * as direct function calls instead of HTTP requests.
 */

// Side-effect import: installs a minimal undici dispatcher that only raises
// TCP connect timeout. Per-request timeouts remain controlled by siteFetch().
import './net';

import { filterGamesBySearchQuery } from '../../utils/searchQueryFilter';
import {
  SITE_CONFIGS as _SITE_CONFIGS,
  MAX_POSTS_PER_SITE as _MAX_POSTS_PER_SITE,
  fetchSteamrip,
  fetchSkidrow,
  fetchDodi,
  fetchFreegog,
  transformPostForV2,
  isValidImageUrl,
  fetchOnlineFixRecent,
  fetchOnlineFixSearch,
  fetchCsrinSearch,
  siteFetch,
} from './helpers.js';

// Cast JS module exports to proper types
const SITE_CONFIGS = _SITE_CONFIGS as Record<string, SiteConfig>;
const MAX_POSTS_PER_SITE = _MAX_POSTS_PER_SITE as Record<string, number>;

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Search Cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const searchCache = new Map<string, { results: TransformedPost[]; timestamp: number }>();

function applySearchTermFilter(results: TransformedPost[], query: string): TransformedPost[] {
  return filterGamesBySearchQuery(results, query);
}
const SEARCH_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// â”€â”€â”€ Internal Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// WordPress REST API caps per_page at 100. To fetch every matching post for a
// search query we request 100 per page and paginate using X-WP-TotalPages.
const SEARCH_PER_PAGE = 100;
// Safety cap on pages per site - 10 pages * 100 = 1000 results, more than any
// real search ever needs, but protects against runaway requests if a site
// reports a bogus total-pages header.
const SEARCH_MAX_PAGES = 10;

// Routes a WP REST URL through the right site-specific fetcher (which handles
// CloudFlare, retries, circuit breakers, etc).
function dispatchWpFetch(siteConfig: SiteConfig, url: string) {
  if (siteConfig.type === 'steamrip') return fetchSteamrip(url);
  if (siteConfig.type === 'skidrow') return fetchSkidrow(url);
  if (siteConfig.type === 'dodi') return fetchDodi(url);
  if (siteConfig.type === 'freegog') return fetchFreegog(url);
  return siteFetch(url, { headers: { 'User-Agent': 'GameSearch-API-v2/2.0' } });
}

async function searchSite(siteConfig: SiteConfig, searchQuery: string): Promise<TransformedPost[]> {
  try {
    if (siteConfig.type === 'onlinefix') {
      return await fetchOnlineFixSearch(searchQuery);
    }

    if (siteConfig.type === 'csrin') {
      return await fetchCsrinSearch(searchQuery);
    }

    const baseParams = new URLSearchParams({
      search: searchQuery,
      orderby: 'date',
      order: 'desc'
    });

    // FreeGOG goes through FlareSolverr (slow + browser automation). Pagination
    // there means N FlareSolverr round-trips per search - stay single-page.
    // Everywhere else: max page size, then paginate until X-WP-TotalPages says
    // we're done (capped at SEARCH_MAX_PAGES for safety).
    const paginate = siteConfig.type !== 'freegog';
    if (paginate) {
      baseParams.set('per_page', String(SEARCH_PER_PAGE));
    }

    const fetchPage = async (page: number) => {
      const params = new URLSearchParams(baseParams);
      if (paginate) params.set('page', String(page));
      const response = await dispatchWpFetch(siteConfig, `${siteConfig.baseUrl}?${params}`);
      if (!response || !response.ok) {
        // WP returns 400 for out-of-range page numbers - treat as "no more
        // results" rather than an error.
        if (response && response.status === 400 && page > 1) {
          return { posts: [] as unknown[], totalPages: page - 1 };
        }
        throw new Error(`${siteConfig.name} returned ${response?.status || 'no response'}`);
      }
      const totalPagesHeader = response.headers.get('x-wp-totalpages');
      const totalPages = totalPagesHeader ? Math.max(1, parseInt(totalPagesHeader, 10) || 1) : 1;
      const posts = await response.json();
      return { posts: Array.isArray(posts) ? posts : [], totalPages };
    };

    const first = await fetchPage(1);
    let allPosts: unknown[] = first.posts;

    if (paginate && first.totalPages > 1) {
      const lastPage = Math.min(first.totalPages, SEARCH_MAX_PAGES);
      const pageNumbers: number[] = [];
      for (let p = 2; p <= lastPage; p++) pageNumbers.push(p);
      // Fetch remaining pages in parallel - the dispatchers already throttle
      // per-site via circuit breakers / FlareSolverr queuing.
      const rest = await Promise.all(
        pageNumbers.map(async p => {
          try {
            return (await fetchPage(p)).posts;
          } catch (err) {
            console.warn(`${siteConfig.name} page ${p} failed:`, err);
            return [];
          }
        })
      );
      for (const pagePosts of rest) allPosts = allPosts.concat(pagePosts);
    }

    const transformPromises = allPosts.map((post: unknown) => transformPostForV2(post, siteConfig, false));
    return dropSiteMetaPosts(siteConfig.type, await Promise.all(transformPromises));
  } catch (error) {
    console.error(`Error searching ${siteConfig.name}:`, error);
    return [];
  }
}

async function fetchRecentFromSite(siteConfig: SiteConfig): Promise<TransformedPost[]> {
  try {
    if (siteConfig.type === 'onlinefix') {
      return await fetchOnlineFixRecent();
    }

    // cs.rin.ru is search-only for now - skip recent uploads to avoid hitting
    // the forum on every home-page refresh.
    if (siteConfig.type === 'csrin') {
      return [];
    }

    const params = new URLSearchParams({
      orderby: 'date',
      order: 'desc'
    });

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
    } else if (siteConfig.type === 'freegog') {
      response = await fetchFreegog(url);
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
    return dropSiteMetaPosts(siteConfig.type, await Promise.all(transformPromises));
  } catch (error) {
    console.error(`Error fetching recent from ${siteConfig.name}:`, error);
    return [];
  }
}

// FitGirl publishes meta posts ("Upcoming Repacks", weekly "Updates
// Digest for <date>") in the same WP feed as actual releases - they'd
// dominate the home page and search results since FitGirl puts them out
// constantly. Filter by slug prefix because it's stable and url-safe;
// titles have unicode dashes that complicate matching.
const FITGIRL_META_SLUG = /^(upcoming-repacks|updates-digest)/i;

function shouldDropPost(siteType: string, post: TransformedPost): boolean {
  if (siteType === 'fitgirl' && FITGIRL_META_SLUG.test(post.slug || '')) {
    return true;
  }
  return false;
}

function dropSiteMetaPosts(siteType: string, posts: TransformedPost[]): TransformedPost[] {
  return posts.filter(p => !shouldDropPost(siteType, p));
}

// â”€â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Sites that we don't want to hit on a default "all sites" search. cs.rin.ru
// is the only one currently - every search there logs in / submits a search
// to the forum, which would get our shared bot account rate-limited or
// banned if we ran it on every casual home-page search. Users must opt in
// by explicitly selecting csrin in the site filter.
const DEFAULT_EXCLUDED_FROM_ALL = new Set(['csrin']);

/**
 * Search games across one, several, or all sites.
 *
 * @param sites
 *   - omitted / undefined / empty: search every site EXCEPT
 *     DEFAULT_EXCLUDED_FROM_ALL (current default = all minus csrin).
 *   - single site key string: backward-compatible single-site behavior.
 *   - string[] or comma-separated string: search exactly those sites
 *     (csrin only included if it's explicitly listed).
 * Unknown site keys are filtered out silently.
 */
export async function searchGames(
  query: string,
  sites?: string | string[],
): Promise<SearchResult> {
  if (!query) {
    return { success: false, results: [], count: 0 };
  }

  // Normalise the `sites` arg into a list of valid SITE_CONFIGS keys, or
  // null when the caller wants the default (all-minus-excluded) behavior.
  const requested: string[] | null = (() => {
    if (sites === undefined || sites === null) return null;
    const raw = Array.isArray(sites)
      ? sites
      : String(sites).split(',');
    const valid = raw
      .map(s => s.trim().toLowerCase())
      .filter(s => s && s !== 'all' && (SITE_CONFIGS as Record<string, unknown>)[s]);
    if (!valid.length) return null;
    return Array.from(new Set(valid));
  })();

  // Build the actual target site list.
  const targets: SiteConfig[] = requested
    ? requested.map(k => SITE_CONFIGS[k] as SiteConfig)
    : (Object.entries(SITE_CONFIGS) as [string, SiteConfig][])
        .filter(([k]) => !DEFAULT_EXCLUDED_FROM_ALL.has(k))
        .map(([, v]) => v);

  // Single-site search serves a recent cached result when the provider is
  // empty or unavailable. Site fetchers already perform their own network and
  // Cloudflare fallbacks, so repeating the whole scrape only adds latency.
  if (targets.length === 1) {
    const siteConfig = targets[0];
    const site = siteConfig.type;
    const results = applySearchTermFilter(await searchSite(siteConfig, query), query);
    const cacheKey = `${site}:${query.toLowerCase()}`;

    if (results.length > 0) {
      searchCache.set(cacheKey, { results, timestamp: Date.now() });
    } else {
      const cached = searchCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL) {
        console.log(`Using cached results for ${site}`);
        const cachedFiltered = applySearchTermFilter(cached.results, query);
        return { success: true, results: cachedFiltered, count: cachedFiltered.length, site, cached: true };
      }
    }

    return { success: true, results, count: results.length, site };
  }

  // Multi-site / all-sites search - parallel fan-out across targets.
  const allSites = targets;
  const searchPromises = allSites.map(s => searchSite(s, query));
  const settledResults = await Promise.allSettled(searchPromises);

  const combinedResults: TransformedPost[] = [];

  settledResults.forEach((result, index) => {
    const s = allSites[index];
    const cacheKey = `${s.type}:${query.toLowerCase()}`;

    if (result.status === 'fulfilled' && result.value.length > 0) {
      searchCache.set(cacheKey, { results: result.value, timestamp: Date.now() });
      combinedResults.push(...result.value);
    } else {
      const reason = result.status === 'rejected' ? result.reason : 'empty results';
      console.warn(`Search returned nothing for ${s.name}: ${reason}`);
      const cached = searchCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL) {
        console.log(`Using cached results for ${s.name} (${cached.results.length} results, age ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
        combinedResults.push(...cached.results);
      } else {
        console.warn(`No cached results available for ${s.name}`);
      }
    }
  });

  const filteredCombined = applySearchTermFilter(combinedResults, query);
  return { success: true, results: filteredCombined, count: filteredCombined.length };
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
 * touch any in-memory cache on its own â€” the caller is responsible for
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
      } else if (siteConfig.type === 'freegog') {
        response = await fetchFreegog(postUrl);
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

