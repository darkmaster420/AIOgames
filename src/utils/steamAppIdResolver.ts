/**
 * Server-side Steam AppID resolver.
 *
 * Takes a (preferably already-cleaned) game title and returns the most likely
 * Steam AppID for it, or null if no confident match exists. Results are cached
 * in-memory by title for a long TTL since a title's AppID rarely changes.
 *
 * This was previously done on the client (see the removed `resolveAppIdFromCleanTitle`
 * effect in `src/app/page.tsx`) which meant every visitor re-did the work and
 * competed with image loads for browser connection slots. Running it on the
 * server lets everyone share one cache.
 */

import { cleanGameTitle, buildSteamSearchQueryVariants } from './steamApi';
import { calculateGameSimilarity } from './titleMatching';

interface SteamSearchHit {
  appid: string;
  name: string;
}

interface CacheEntry {
  appId: string | null;
  timestamp: number;
  // `true` when the miss was caused by a network / timeout / parse error, so
  // we can expire it aggressively and retry on the next enrichment pass.
  transient?: boolean;
}

const resolverCache = new Map<string, CacheEntry>();
// Successful resolutions are effectively permanent (7 days). Negative lookups
// get a much shorter TTL so new Steam listings can be picked up relatively
// quickly — and we shorten it further for network/transient failures so a
// single blip doesn't lock out a title for the whole hour.
const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 15 * 60 * 1000; // 15m: genuine "not found" on Steam
const TRANSIENT_FAIL_TTL_MS = 60 * 1000; // 1m: Steam request errored out

const SIMILARITY_THRESHOLD = 0.45;
const MAX_CANDIDATES = 8;
const STEAM_SEARCH_URL = 'https://steamcommunity.com/actions/SearchApps/';
const STEAM_SEARCH_TIMEOUT_MS = 8000;

// Dedupe in-flight requests for the same title so concurrent resolve() calls
// don't each hit Steam's endpoint.
const inflight = new Map<string, Promise<string | null>>();

function ttlForEntry(entry: CacheEntry): number {
  if (entry.appId) return POSITIVE_TTL_MS;
  return entry.transient ? TRANSIENT_FAIL_TTL_MS : NEGATIVE_TTL_MS;
}

function getCached(key: string): CacheEntry | null {
  const entry = resolverCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlForEntry(entry)) {
    resolverCache.delete(key);
    return null;
  }
  return entry;
}

interface SearchResult {
  hits: SteamSearchHit[];
  /** `true` if Steam returned a successful (even empty) response. `false` if
   *  the request errored out — we use this to flag cache entries as
   *  transient so they get retried promptly instead of sitting in the
   *  15-minute negative cache. */
  ok: boolean;
}

async function searchSteamCommunity(query: string): Promise<SearchResult> {
  try {
    const response = await fetch(`${STEAM_SEARCH_URL}${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(STEAM_SEARCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'AIOGames-AppIdResolver/1.0' },
    });
    if (!response.ok) return { hits: [], ok: false };
    const data = await response.json();
    if (!Array.isArray(data)) return { hits: [], ok: false };
    const hits = data
      .slice(0, 20)
      .map((item: { appid: string | number; name: string }) => ({
        appid: String(item.appid),
        name: item.name || '',
      }))
      .filter((hit: SteamSearchHit) => hit.appid && hit.name);
    return { hits, ok: true };
  } catch {
    return { hits: [], ok: false };
  }
}

interface DoResolveResult {
  appId: string | null;
  transient: boolean;
}

async function doResolve(cleanTitle: string): Promise<DoResolveResult> {
  if (!cleanTitle || cleanTitle.length < 2) {
    return { appId: null, transient: false };
  }

  const variants = buildSteamSearchQueryVariants(cleanTitle);
  const seen = new Set<string>();
  const candidates: SteamSearchHit[] = [];
  let anyOk = false;

  for (const variant of variants) {
    const { hits, ok } = await searchSteamCommunity(variant);
    if (ok) anyOk = true;
    for (const hit of hits) {
      if (seen.has(hit.appid)) continue;
      seen.add(hit.appid);
      candidates.push(hit);
    }
    // Short-circuit once we have enough candidates from the earliest variants
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  // If every variant request errored, treat the whole lookup as transient —
  // a future refresh should retry within a minute instead of waiting 15.
  if (!anyOk && candidates.length === 0) {
    return { appId: null, transient: true };
  }

  if (candidates.length === 0) return { appId: null, transient: false };

  let best: { appid: string; score: number } | null = null;
  for (const hit of candidates.slice(0, MAX_CANDIDATES)) {
    const base = calculateGameSimilarity(cleanTitle, hit.name);
    const exactBonus = cleanGameTitle(hit.name) === cleanTitle ? 0.2 : 0;
    const score = base + exactBonus;
    if (!best || score > best.score) {
      best = { appid: hit.appid, score };
    }
  }

  if (best && best.score >= SIMILARITY_THRESHOLD) {
    return { appId: best.appid, transient: false };
  }
  return { appId: null, transient: false };
}

/**
 * Synchronous cache peek. Returns the cached AppID if we have one, `null` if
 * we've cached a negative result, or `undefined` if the title hasn't been
 * resolved yet. Never triggers a network request.
 */
export function peekCachedSteamAppId(rawTitle: string): string | null | undefined {
  const cleanTitle = cleanGameTitle(rawTitle || '').trim();
  if (!cleanTitle) return undefined;
  const entry = getCached(cleanTitle.toLowerCase());
  return entry ? entry.appId : undefined;
}

/**
 * Resolve a Steam AppID for the given title. Cached indefinitely for hits,
 * briefly for misses. Safe to call concurrently for the same title.
 */
export async function resolveSteamAppId(rawTitle: string): Promise<string | null> {
  const cleanTitle = cleanGameTitle(rawTitle || '').trim();
  if (!cleanTitle || cleanTitle.length < 2) return null;

  const key = cleanTitle.toLowerCase();
  const cached = getCached(key);
  if (cached) return cached.appId;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { appId, transient } = await doResolve(cleanTitle);
      resolverCache.set(key, { appId, timestamp: Date.now(), transient });
      return appId;
    } catch (err) {
      console.warn(`[steamAppIdResolver] Failed to resolve "${cleanTitle}":`, err);
      // Cache the negative as transient so the next enrichment pass retries
      // within a minute instead of waiting 15.
      resolverCache.set(key, { appId: null, timestamp: Date.now(), transient: true });
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Forget every cached negative result (both transient and genuine misses).
 * Positive hits are left alone — they are effectively permanent.
 *
 * Used by the /api/games/recent reverify path to force a re-query of Steam
 * for all titles the previous pass couldn't resolve, without invalidating
 * the good matches we've already found.
 */
export function clearNegativeAppIdCache(): number {
  let removed = 0;
  for (const [key, entry] of resolverCache) {
    if (!entry.appId) {
      resolverCache.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Resolve AppIDs for a batch of titles in parallel with a concurrency cap.
 * Returns a map keyed by the *original* raw title -> appId (or null).
 */
export async function resolveSteamAppIdsBatch(
  rawTitles: string[],
  concurrency = 6
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const queue = rawTitles.filter(t => typeof t === 'string' && t.trim().length > 0);
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const i = cursor++;
      const raw = queue[i];
      try {
        const appId = await resolveSteamAppId(raw);
        results.set(raw, appId);
      } catch {
        results.set(raw, null);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return results;
}
