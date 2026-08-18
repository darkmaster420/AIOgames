/**
 * Server-side image cache for `/api/proxy-image` only.
 *
 * This is **not** used for WordPress REST or HTML scraping. Those flows stay
 * in `lib/gameapi/helpers.js` (`fetchSkidrow`, `fetchSteamrip`, etc.) and still
 * use FlareSolverr / cf_clearance when Cloudflare blocks JSON or pages.
 *
 * Here we only cache **poster image bytes**. Every image is fetched with plain
 * HTTPS. When SteamRip, Skidrow, FreeGOG or DODI responds with a Cloudflare
 * challenge, FlareSolverr is used only to obtain cookies and a matching
 * User-Agent; the app then retries the image directly with that clearance.
 *
 * Caches the raw bytes of images fetched through the proxy so that:
 *   1) Repeat requests for the same image are served from memory instantly,
 *      without re-hitting external CDNs or repeating expensive cookie refresh.
 *   2) Background jobs (see /api/games/recent enrichment) can *warm* the cache
 *      after scraping, so by the time the user's browser asks for each image
 *      it's a fast memory hit — no contention with the browser's per-origin
 *      HTTP/1.1 connection limit, no hammering of the origin sites.
 *
 * The cache is process-local and naive: a plain Map with a soft size cap and
 * LRU-ish eviction. That's fine for our scale.
 */

import { getFlaresolverrClearance } from '../lib/gameapi/helpers.js';

interface CookieJar {
  cf_clearance: string | null;
  cookies: string[];
  userAgent: string | null;
  expires_at: number;
}

type SiteKey = 'steamrip' | 'skidrow' | 'freegog' | 'dodi';

type ProtectedImageSite = {
  match: (host: string) => boolean;
  key: SiteKey;
  referer: string;
  clearanceUrl: string;
  session: string;
};

const HOST_MATCHERS: ProtectedImageSite[] = [
  {
    match: h => h.includes('steamrip.com'),
    key: 'steamrip',
    referer: 'https://steamrip.com/',
    clearanceUrl: 'https://steamrip.com/',
    session: 'image-steamrip',
  },
  {
    match: h => h.includes('skidrowreloaded.com'),
    key: 'skidrow',
    referer: 'https://www.skidrowreloaded.com/',
    clearanceUrl: 'https://www.skidrowreloaded.com/',
    session: 'image-skidrow',
  },
  {
    match: h => h.includes('freegogpcgames.com'),
    key: 'freegog',
    referer: 'https://freegogpcgames.com/',
    clearanceUrl: 'https://freegogpcgames.com/',
    session: 'image-freegog',
  },
  {
    match: h => h.includes('dodi-repacks.download') || h.includes('dodi-repacks.site') || h.includes('dodi-repacks.com'),
    key: 'dodi',
    referer: 'https://dodi-repacks.site/',
    clearanceUrl: 'https://dodi-repacks.site/',
    session: 'image-dodi',
  },
];

// A discovery page can request dozens of posters at once. Without this guard,
// every challenged image can launch its own browser solve before the first one
// has populated the shared cookie jar.
const clearanceCache = new Map<SiteKey, CookieJar>();
const clearanceInflight = new Map<SiteKey, Promise<CookieJar | null>>();

function getCachedClearance(site: ProtectedImageSite): CookieJar | null {
  const cached = clearanceCache.get(site.key);
  if (
    cached?.cookies.length &&
    Date.now() < cached.expires_at - 60_000
  ) {
    return cached;
  }
  clearanceCache.delete(site.key);
  return null;
}

async function getClearanceJar(site: ProtectedImageSite, forceFresh: boolean): Promise<CookieJar | null> {
  const cached = getCachedClearance(site);
  if (!forceFresh && cached) return cached;

  const existing = clearanceInflight.get(site.key);
  if (existing) return existing;

  const pending = (getFlaresolverrClearance(site.clearanceUrl, site.session) as Promise<CookieJar>)
    .then(jar => {
      clearanceCache.set(site.key, jar);
      return jar;
    })
    .catch(error => {
      console.warn(`[imageCache] Failed to obtain ${site.key} clearance:`, error);
      return null;
    })
    .finally(() => clearanceInflight.delete(site.key));

  clearanceInflight.set(site.key, pending);
  return pending;
}

interface CachedImage {
  buffer: ArrayBuffer;
  contentType: string;
  timestamp: number;
  lastAccessed: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — default for plain CDN images
// CF-protected images are expensive to (re)fetch (FlareSolverr round trip +
// Cloudflare clearance) so we cache them aggressively. Posters basically
// don't change, so keeping the bytes for a week is fine and saves the user
// a perceptible delay every time they come back.
const CF_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 1500;

export function isCfProtectedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOST_MATCHERS.some(m => m.match(host));
  } catch {
    return false;
  }
}

function ttlForUrl(url: string): number {
  return isCfProtectedUrl(url) ? CF_CACHE_TTL_MS : CACHE_TTL_MS;
}

const cache = new Map<string, CachedImage>();
const inflight = new Map<string, Promise<CachedImage | null>>();
// Titles/URLs that recently failed — skip prefetching until the record expires
// so we don't keep retrying broken/Cloudflare-hostile URLs.
const failedUrls = new Map<string, number>();
const FAILURE_TTL_MS = 30 * 1000; // 30s — short enough that transient blips recover quickly
// Hosts we trust to normally just work over plain fetch. We NEVER cache
// negatives for these so one transient network hiccup doesn't poison a
// working image URL for any length of time.
const NEVER_CACHE_FAILURE_HOSTS = [
  'cdn.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'steamcdn-a.akamaihd.net',
  'images.igdb.com',
  'media.rawg.io',
  'shared.fastly.steamstatic.com',
];

function shouldCacheFailure(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !NEVER_CACHE_FAILURE_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch {
    return true;
  }
}

function buildHeaders(jar: CookieJar | null, referer: string, includeReferer: boolean): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent':
      jar?.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    // Omit Accept-Encoding so undici picks a safe default and auto-decompresses.
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (includeReferer) {
    headers['Referer'] = referer;
  }
  if (jar?.cookies?.length) {
    headers['Cookie'] = jar.cookies.join('; ');
  }
  return headers;
}

function looksLikeChallenge(res: Response): boolean {
  if (res.status === 403 || res.status === 503) return true;
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('text/html')) return true;
  return false;
}

function evictIfNeeded() {
  if (cache.size <= MAX_ENTRIES) return;
  // Evict the oldest-accessed entries until we're back under the cap.
  const entries = Array.from(cache.entries())
    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  const toDrop = cache.size - MAX_ENTRIES;
  for (let i = 0; i < toDrop; i++) {
    cache.delete(entries[i][0]);
  }
}

export function getCachedImage(url: string): CachedImage | null {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlForUrl(url)) {
    cache.delete(url);
    return null;
  }
  entry.lastAccessed = Date.now();
  return entry;
}

function isFailedRecently(url: string): boolean {
  const ts = failedUrls.get(url);
  if (!ts) return false;
  if (Date.now() - ts > FAILURE_TTL_MS) {
    failedUrls.delete(url);
    return false;
  }
  return true;
}

async function fetchImage(url: string): Promise<CachedImage | null> {
  let validUrl: URL;
  try {
    validUrl = new URL(url);
  } catch {
    return null;
  }
  if (validUrl.protocol !== 'https:') return null;

  const host = validUrl.hostname.toLowerCase();
  const matcher = HOST_MATCHERS.find(m => m.match(host));

  const requestImage = async (jar: CookieJar | null): Promise<Response | null> => {
    try {
      return await fetch(url, {
        headers: buildHeaders(
          jar,
          matcher?.referer || validUrl.origin,
          Boolean(matcher),
        ),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      console.warn(
        `[imageCache] ${jar ? 'Clearance' : 'Direct'} fetch for ${host} threw:`,
        error instanceof Error ? `${error.name}: ${error.message}` : error,
      );
      return null;
    }
  };

  // Image bytes always travel directly from the origin to this app. Start
  // without FlareSolverr when no clearance is cached because many origins only
  // challenge intermittently. Once solved, use the cached jar immediately.
  const initialJar = matcher ? getCachedClearance(matcher) : null;
  let response = await requestImage(initialJar);

  if (response && looksLikeChallenge(response) && matcher) {
    await response.body?.cancel().catch(() => {});
    if (initialJar) clearanceCache.delete(matcher.key);
    const jar = await getClearanceJar(matcher, Boolean(initialJar));
    if (jar) {
      response = await requestImage(jar);
      if (response && looksLikeChallenge(response)) clearanceCache.delete(matcher.key);
    }
  }

  // Retry one transient network/server failure without involving FlareSolverr.
  // Challenges are deliberately excluded: another plain request cannot solve
  // one and would only add latency.
  if ((!response || response.status >= 500) && !(response && looksLikeChallenge(response))) {
    await response?.body?.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 150));
    response = await requestImage(initialJar);
  }

  if (!response) return null;

  if (!response.ok || looksLikeChallenge(response)) {
    console.warn(
      `[imageCache] Rejecting ${host}: status=${response.status} ct=${response.headers.get('content-type')}`
    );
    return null;
  }

  try {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      console.warn(`[imageCache] Empty body from ${host}`);
      return null;
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      buffer,
      contentType,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
    };
  } catch (err) {
    console.warn(`[imageCache] Failed to read body from ${host}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Get an image from the cache, fetching it if absent. Concurrent callers for
 * the same URL share a single underlying fetch.
 */
export async function getOrFetchImage(url: string): Promise<CachedImage | null> {
  const cached = getCachedImage(url);
  if (cached) return cached;
  if (isFailedRecently(url)) return null;

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const result = await fetchImage(url);
      if (result) {
        cache.set(url, result);
        evictIfNeeded();
      } else if (shouldCacheFailure(url)) {
        failedUrls.set(url, Date.now());
      }
      return result;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, promise);
  return promise;
}

/**
 * Best-effort prefetch — fetches the image and populates the cache, silent on
 * failure. Safe to fire-and-forget from background enrichment.
 */
export async function prefetchImage(url: string): Promise<void> {
  if (!url) return;
  try {
    await getOrFetchImage(url);
  } catch {
    /* swallow */
  }
}

/**
 * Warm the cache for a batch of image URLs with a concurrency cap. Returns
 * the number of images successfully cached.
 */
export async function prefetchImageBatch(urls: string[], concurrency = 3): Promise<number> {
  const queue = Array.from(new Set(urls.filter(u => typeof u === 'string' && u.length > 0)));
  let cursor = 0;
  let successCount = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const i = cursor++;
      const result = await getOrFetchImage(queue[i]);
      if (result) successCount++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return successCount;
}

export function getImageCacheStats() {
  return {
    size: cache.size,
    maxEntries: MAX_ENTRIES,
    ttlMs: CACHE_TTL_MS,
    failureEntries: failedUrls.size,
  };
}
