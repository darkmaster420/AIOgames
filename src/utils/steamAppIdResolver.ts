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
}

const resolverCache = new Map<string, CacheEntry>();
// Successful resolutions are effectively permanent (7 days). Negative lookups
// get a much shorter TTL so new Steam listings can be picked up relatively
// quickly.
const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;

const SIMILARITY_THRESHOLD = 0.45;
const MAX_CANDIDATES = 8;
const STEAM_SEARCH_URL = 'https://steamcommunity.com/actions/SearchApps/';
const STEAM_SEARCH_TIMEOUT_MS = 5000;

// Dedupe in-flight requests for the same title so concurrent resolve() calls
// don't each hit Steam's endpoint.
const inflight = new Map<string, Promise<string | null>>();

function getCached(key: string): CacheEntry | null {
  const entry = resolverCache.get(key);
  if (!entry) return null;
  const ttl = entry.appId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  if (Date.now() - entry.timestamp > ttl) {
    resolverCache.delete(key);
    return null;
  }
  return entry;
}

async function searchSteamCommunity(query: string): Promise<SteamSearchHit[]> {
  try {
    const response = await fetch(`${STEAM_SEARCH_URL}${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(STEAM_SEARCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'AIOGames-AppIdResolver/1.0' },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data
      .slice(0, 20)
      .map((item: { appid: string | number; name: string }) => ({
        appid: String(item.appid),
        name: item.name || '',
      }))
      .filter(hit => hit.appid && hit.name);
  } catch {
    return [];
  }
}

async function doResolve(cleanTitle: string): Promise<string | null> {
  if (!cleanTitle || cleanTitle.length < 2) return null;

  const variants = buildSteamSearchQueryVariants(cleanTitle);
  const seen = new Set<string>();
  const candidates: SteamSearchHit[] = [];

  for (const variant of variants) {
    const hits = await searchSteamCommunity(variant);
    for (const hit of hits) {
      if (seen.has(hit.appid)) continue;
      seen.add(hit.appid);
      candidates.push(hit);
    }
    // Short-circuit once we have enough candidates from the earliest variants
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  if (candidates.length === 0) return null;

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
    return best.appid;
  }
  return null;
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
      const appId = await doResolve(cleanTitle);
      resolverCache.set(key, { appId, timestamp: Date.now() });
      return appId;
    } catch (err) {
      console.warn(`[steamAppIdResolver] Failed to resolve "${cleanTitle}":`, err);
      // Cache the negative briefly to avoid hammering on transient errors.
      resolverCache.set(key, { appId: null, timestamp: Date.now() });
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
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
