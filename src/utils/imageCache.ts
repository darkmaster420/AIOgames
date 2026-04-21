/**
 * Server-side image cache.
 *
 * Caches the raw bytes of images fetched through the proxy so that:
 *   1) Repeat requests for the same image are served from memory instantly,
 *      without re-hitting external CDNs or running another FlareSolverr
 *      Cloudflare-clearance dance.
 *   2) Background jobs (see /api/games/recent enrichment) can *warm* the cache
 *      after scraping, so by the time the user's browser asks for each image
 *      it's a fast memory hit — no contention with the browser's per-origin
 *      HTTP/1.1 connection limit, no hammering of the origin sites.
 *
 * The cache is process-local and naive: a plain Map with a soft size cap and
 * LRU-ish eviction. That's fine for our scale.
 */

import {
  getValidSteamripCookie,
  getValidSkidrowCookie,
  getValidDodiCookie,
  getFreshSteamripCookie,
  getFreshSkidrowCookie,
  getFreshDodiCookie,
} from '../lib/gameapi/helpers.js';

interface CookieJar {
  cf_clearance: string | null;
  cookies: string[];
  userAgent: string | null;
  expires_at: number;
}

type SiteKey = 'steamrip' | 'skidrow' | 'dodi';

const HOST_MATCHERS: Array<{
  match: (host: string) => boolean;
  key: SiteKey;
  getValid: () => Promise<CookieJar>;
  getFresh: () => Promise<CookieJar>;
}> = [
  {
    match: h => h.includes('steamrip.com'),
    key: 'steamrip',
    getValid: getValidSteamripCookie as () => Promise<CookieJar>,
    getFresh: getFreshSteamripCookie as () => Promise<CookieJar>,
  },
  {
    match: h => h.includes('skidrowreloaded.com'),
    key: 'skidrow',
    getValid: getValidSkidrowCookie as () => Promise<CookieJar>,
    getFresh: getFreshSkidrowCookie as () => Promise<CookieJar>,
  },
  {
    match: h => h.includes('dodi-repacks.download') || h.includes('dodi-repacks.site') || h.includes('dodi-repacks.com'),
    key: 'dodi',
    getValid: getValidDodiCookie as () => Promise<CookieJar>,
    getFresh: getFreshDodiCookie as () => Promise<CookieJar>,
  },
];

interface CachedImage {
  buffer: ArrayBuffer;
  contentType: string;
  timestamp: number;
  lastAccessed: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ENTRIES = 500;

const cache = new Map<string, CachedImage>();
const inflight = new Map<string, Promise<CachedImage | null>>();
// Titles/URLs that recently failed — skip prefetching until the record expires
// so we don't keep retrying broken/Cloudflare-hostile URLs.
const failedUrls = new Map<string, number>();
const FAILURE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function buildHeaders(jar: CookieJar | null, referer: string): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent':
      jar?.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
  };
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
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
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

  let response: Response | null = null;

  if (matcher) {
    try {
      let jar: CookieJar | null = null;
      try {
        jar = await matcher.getValid();
      } catch (err) {
        console.warn(`[imageCache] Failed to get ${matcher.key} cookie:`, err);
      }
      if (jar) {
        response = await fetch(url, {
          headers: buildHeaders(jar, validUrl.origin),
          signal: AbortSignal.timeout(15000),
        });
        if (looksLikeChallenge(response)) {
          try {
            const fresh = await matcher.getFresh();
            response = await fetch(url, {
              headers: buildHeaders(fresh, validUrl.origin),
              signal: AbortSignal.timeout(15000),
            });
          } catch (err) {
            console.warn(`[imageCache] Failed to refresh ${matcher.key} cookie:`, err);
          }
        }
      }
    } catch (err) {
      console.warn(`[imageCache] Cookie-based fetch failed for ${host}:`, err);
    }
  }

  if (!response || looksLikeChallenge(response)) {
    try {
      response = await fetch(url, {
        headers: buildHeaders(null, validUrl.origin),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      console.warn(`[imageCache] Plain fetch failed for ${host}:`, err);
      return null;
    }
  }

  if (!response.ok || looksLikeChallenge(response)) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return {
    buffer,
    contentType,
    timestamp: Date.now(),
    lastAccessed: Date.now(),
  };
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
      } else {
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
