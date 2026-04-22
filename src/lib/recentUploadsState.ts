/**
 * Shared in-memory state and background-enrichment primitives for the
 * /api/games/recent route and any sibling routes that want to mutate the
 * cached grid (e.g. the per-site refresh endpoint).
 *
 * Next.js App Router's `route.ts` files are not allowed to export helpers
 * beyond the HTTP verbs, so this module holds the cache, enrichment queues,
 * per-site refresh scheduling, and auto-recovery logic that used to live
 * inside the route handler.
 */

import { cleanGameTitle } from '../utils/steamApi';
import { resolveIGDBImage, clearNegativeImageCache } from '../utils/igdb';
import {
  getRecentUploads,
  getRecentUploadsForSite,
  listSiteKeys,
  getSiteDisplayName,
} from './gameapi';
import {
  peekCachedSteamAppId,
  resolveSteamAppIdsBatch,
  clearNegativeAppIdCache,
} from '../utils/steamAppIdResolver';
import { prefetchImageBatch, getCachedImage } from '../utils/imageCache';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Game {
  siteType: string;
  id: string;
  title: string;
  originalTitle?: string;
  source: string;
  appid?: number | string;
  appId?: number | string;
  steamAppId?: number | string;
  steam_appid?: number | string;
  [key: string]: unknown;
}

export interface SiteStat {
  total: number;
  verified: number;
  unverified: number;
  /** verified / unverified, or Infinity if there are no unverified posts. */
  ratio: number;
}

export interface AutoRecoveryReport {
  stats: Record<string, SiteStat>;
  emptySites: string[];
  overloadedSites: string[];
  refreshedSites: string[];
  reverifyTriggered: boolean;
}

// ─── Cache state ───────────────────────────────────────────────────────────

interface CachedRecent {
  results: Game[];
  timestamp: number;
  siteKey: string;
}

let cachedRecent: CachedRecent | null = null;
export const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function getCachedRecent(): CachedRecent | null {
  return cachedRecent;
}

export function setCachedRecent(next: CachedRecent | null): void {
  cachedRecent = next;
}

// ─── Per-title failure cooldowns ───────────────────────────────────────────

const failedImageTitles = new Map<string, number>();
const failedAppIdTitles = new Map<string, number>();

const IMAGE_RETRY_AFTER_MS = 10 * 60 * 1000; // 10m — aligned with IMAGE_MISS_TTL in utils/igdb.ts
const APPID_RETRY_AFTER_MS = 2 * 60 * 1000; //  2m — short enough for a few refreshes to pick up
//                                                 anything whose resolver cache has expired.

function shouldRetryTitle(map: Map<string, number>, key: string): boolean {
  const until = map.get(key);
  if (!until) return true;
  if (Date.now() >= until) {
    map.delete(key);
    return true;
  }
  return false;
}

function pruneFailedTitleMap(map: Map<string, number>): void {
  const now = Date.now();
  for (const [key, until] of map) {
    if (now >= until) map.delete(key);
  }
}

export function clearFailureCooldowns(): void {
  failedImageTitles.clear();
  failedAppIdTitles.clear();
}

// ─── Auto-recovery tunables ────────────────────────────────────────────────

export const UNVERIFIED_TRIGGER = Math.max(
  1,
  parseInt(process.env.RECENT_UNVERIFIED_TRIGGER || '10', 10) || 10
);
export const VERIFIED_RATIO = (() => {
  const raw = parseFloat(process.env.RECENT_VERIFIED_RATIO || '2');
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
})();
const SITE_REFRESH_COOLDOWN_MS = Math.max(
  30_000,
  parseInt(process.env.RECENT_SITE_REFRESH_COOLDOWN_MS || '300000', 10) || 300_000
);
const REVERIFY_COOLDOWN_MS = Math.max(
  30_000,
  parseInt(process.env.RECENT_REVERIFY_COOLDOWN_MS || '300000', 10) || 300_000
);

const lastSiteRefreshAt = new Map<string, number>();
let lastReverifyAt = 0;
const inflightSiteRefreshes = new Set<string>();

// ─── Helpers ───────────────────────────────────────────────────────────────

export function hasNativeAppId(game: Game): boolean {
  const candidates = [game.appid, game.appId, game.steamAppId, game.steam_appid];
  return candidates.some(c => c !== undefined && c !== null && /^\d+$/.test(String(c).trim()));
}

// ─── Background enrichment ─────────────────────────────────────────────────

let enrichmentRunning = false;
let appIdEnrichmentRunning = false;
let imagePrefetchRunning = false;

export function enrichInBackground(): void {
  if (enrichmentRunning || !cachedRecent) return;

  pruneFailedTitleMap(failedImageTitles);

  const gamesNeedingImages = cachedRecent.results.filter((g: Game) => {
    if (g.image) return false;
    const searchTitle = (g.title as string).trim();
    if (!searchTitle) return false;
    return shouldRetryTitle(failedImageTitles, searchTitle.toLowerCase());
  });

  if (gamesNeedingImages.length === 0) return;

  enrichmentRunning = true;
  console.log(`[Recent] Background enrichment starting for ${gamesNeedingImages.length} games...`);

  (async () => {
    try {
      const imageMap = new Map<string, string>();
      for (const game of gamesNeedingImages) {
        const searchTitle = (game.title as string).trim();
        if (!searchTitle || imageMap.has(searchTitle)) continue;

        const image = await resolveIGDBImage(searchTitle);
        if (image) {
          imageMap.set(searchTitle, image);
        } else {
          failedImageTitles.set(
            searchTitle.toLowerCase(),
            Date.now() + IMAGE_RETRY_AFTER_MS
          );
        }
        // 300ms delay between requests to stay under IGDB rate limit
        await new Promise(r => setTimeout(r, 300));
      }

      if (imageMap.size > 0 && cachedRecent) {
        cachedRecent.results = cachedRecent.results.map((game: Game) => {
          if (!game.image) {
            const searchTitle = (game.title as string).trim();
            const igdbImage = imageMap.get(searchTitle);
            if (igdbImage) return { ...game, image: igdbImage } as Game;
          }
          return game;
        });
        console.log(`[Recent] Background enrichment done: ${imageMap.size} images resolved`);
      } else {
        console.log(`[Recent] Background enrichment done: no new images`);
      }
    } catch (error) {
      console.error('[Recent] Background enrichment error:', error);
    } finally {
      enrichmentRunning = false;
      prefetchImageBytesInBackground();
    }
  })();
}

export function prefetchImageBytesInBackground(): void {
  if (imagePrefetchRunning || !cachedRecent) return;

  const urls: string[] = [];
  for (const g of cachedRecent.results) {
    const url = g.image;
    if (typeof url !== 'string' || !url) continue;
    if (getCachedImage(url)) continue;
    urls.push(url);
  }
  if (urls.length === 0) return;

  imagePrefetchRunning = true;
  console.log(`[Recent] Background image-byte prefetch starting for ${urls.length} images...`);

  (async () => {
    try {
      const cachedCount = await prefetchImageBatch(urls, 3);
      console.log(`[Recent] Background image-byte prefetch done: ${cachedCount}/${urls.length} cached`);
    } catch (error) {
      console.error('[Recent] Background image-byte prefetch error:', error);
    } finally {
      imagePrefetchRunning = false;
    }
  })();
}

export function enrichAppIdsInBackground(): void {
  if (appIdEnrichmentRunning || !cachedRecent) return;

  pruneFailedTitleMap(failedAppIdTitles);

  const gamesNeedingAppId = cachedRecent.results.filter((g: Game) => {
    if (hasNativeAppId(g)) return false;
    const cleanTitle = cleanGameTitle(g.originalTitle || g.title || '').trim();
    if (!cleanTitle) return false;
    return shouldRetryTitle(failedAppIdTitles, cleanTitle.toLowerCase());
  });

  if (gamesNeedingAppId.length === 0) return;

  appIdEnrichmentRunning = true;
  console.log(`[Recent] Background AppID enrichment starting for ${gamesNeedingAppId.length} games...`);

  (async () => {
    try {
      const titles = gamesNeedingAppId.map(g => (g.originalTitle || g.title || '') as string);
      const resolvedMap = await resolveSteamAppIdsBatch(titles, 6);

      let resolvedCount = 0;
      if (cachedRecent) {
        cachedRecent.results = cachedRecent.results.map((game: Game) => {
          if (hasNativeAppId(game)) return game;
          const rawTitle = (game.originalTitle || game.title || '') as string;
          const appId = resolvedMap.get(rawTitle);
          if (appId) {
            resolvedCount++;
            return { ...game, appid: appId } as Game;
          }
          const cleanTitle = cleanGameTitle(rawTitle).trim();
          if (cleanTitle) {
            failedAppIdTitles.set(
              cleanTitle.toLowerCase(),
              Date.now() + APPID_RETRY_AFTER_MS
            );
          }
          return game;
        });
      }
      console.log(`[Recent] Background AppID enrichment done: ${resolvedCount} resolved`);
    } catch (error) {
      console.error('[Recent] Background AppID enrichment error:', error);
    } finally {
      appIdEnrichmentRunning = false;
    }
  })();
}

// ─── Bulk fetch ────────────────────────────────────────────────────────────

export async function fetchAndCacheRecent(): Promise<{ results: Game[]; error?: string }> {
  const data = await getRecentUploads();

  if (!data.success || !data.results || !Array.isArray(data.results)) {
    cachedRecent = null;
    console.error('Invalid API response structure:', data);
    return { results: [], error: 'Invalid API response structure' };
  }

  const results: Game[] = data.results.map((game: unknown) => {
    const g = game as Game;
    const originalTitle = g.title;
    const cleanedTitle = cleanGameTitle(g.title);
    const next: Game = {
      ...g,
      originalTitle,
      title: cleanedTitle,
    };
    if (!hasNativeAppId(next)) {
      const cached = peekCachedSteamAppId(originalTitle);
      if (cached) next.appid = cached;
    }
    return next;
  });

  // Reset failure sets on fresh data fetch so previously-failed titles get
  // another attempt.
  clearFailureCooldowns();

  cachedRecent = { results, timestamp: Date.now(), siteKey: 'all' };

  enrichInBackground();
  enrichAppIdsInBackground();
  prefetchImageBytesInBackground();

  return { results };
}

// ─── Per-site stats ────────────────────────────────────────────────────────

export function computeSiteStats(games: Game[]): Record<string, SiteStat> {
  const stats: Record<string, SiteStat> = {};
  for (const key of listSiteKeys()) {
    stats[key] = { total: 0, verified: 0, unverified: 0, ratio: Infinity };
  }

  for (const game of games) {
    const siteKey = String(game.siteType || '').trim();
    if (!siteKey) continue;
    if (!stats[siteKey]) {
      stats[siteKey] = { total: 0, verified: 0, unverified: 0, ratio: Infinity };
    }
    stats[siteKey].total += 1;
    if (hasNativeAppId(game)) {
      stats[siteKey].verified += 1;
    } else {
      stats[siteKey].unverified += 1;
    }
  }

  for (const key of Object.keys(stats)) {
    const s = stats[key];
    s.ratio = s.unverified === 0 ? Infinity : s.verified / s.unverified;
  }

  return stats;
}

export function findEmptySiteKeys(stats: Record<string, SiteStat>): string[] {
  return Object.keys(stats).filter(k => stats[k].total === 0);
}

export function findOverloadedSiteKeys(stats: Record<string, SiteStat>): string[] {
  const overloaded: string[] = [];
  for (const [key, s] of Object.entries(stats)) {
    if (s.unverified >= UNVERIFIED_TRIGGER && s.ratio < VERIFIED_RATIO) {
      overloaded.push(key);
    }
  }
  return overloaded;
}

// ─── Per-site background refresh ───────────────────────────────────────────

export interface RefreshSiteOptions {
  /** Skip the rate-limit check. Used by the on-demand endpoint. */
  bypassCooldown?: boolean;
  /** Free-form reason string logged for diagnostics. */
  reason?: string;
}

export interface RefreshSiteResult {
  started: boolean;
  reason?: string;
}

export function refreshSiteInBackground(
  siteKey: string,
  opts: RefreshSiteOptions = {}
): RefreshSiteResult {
  const siteName = getSiteDisplayName(siteKey);
  if (!siteName) {
    return { started: false, reason: 'unknown-site' };
  }

  if (inflightSiteRefreshes.has(siteKey)) {
    return { started: false, reason: 'already-in-flight' };
  }

  const lastAt = lastSiteRefreshAt.get(siteKey) || 0;
  const elapsed = Date.now() - lastAt;
  if (!opts.bypassCooldown && elapsed < SITE_REFRESH_COOLDOWN_MS) {
    const remaining = Math.ceil((SITE_REFRESH_COOLDOWN_MS - elapsed) / 1000);
    return { started: false, reason: `cooldown-${remaining}s` };
  }

  inflightSiteRefreshes.add(siteKey);
  lastSiteRefreshAt.set(siteKey, Date.now());

  console.log(
    `[Recent] Per-site refresh starting for ${siteName} (${siteKey})` +
      (opts.reason ? ` — reason: ${opts.reason}` : '')
  );

  (async () => {
    try {
      const result = await getRecentUploadsForSite(siteKey);
      if (!result.success) {
        console.warn(
          `[Recent] Per-site refresh for ${siteName} failed: ${result.error || 'unknown error'}`
        );
        return;
      }

      // Seed AppIDs we already have cached, just like the bulk path does.
      const freshResults: Game[] = result.results.map((game) => {
        const g = game as unknown as Game;
        const originalTitle = (g.title as string) || '';
        const cleanedTitle = cleanGameTitle(originalTitle);
        const next: Game = {
          ...g,
          originalTitle,
          title: cleanedTitle,
        };
        if (!hasNativeAppId(next)) {
          const cached = peekCachedSteamAppId(originalTitle);
          if (cached) next.appid = cached;
        }
        return next;
      });

      if (!cachedRecent) {
        console.log(
          `[Recent] Per-site refresh for ${siteName} produced ${freshResults.length} posts ` +
            `but cache is empty; skipping merge (will be picked up on next full fetch).`
        );
        return;
      }

      // Replace every entry for this site with the fresh set, keep everything
      // else untouched, then resort by date so the grid stays chronological.
      const prevCount = cachedRecent.results.filter((g) => g.siteType === siteKey).length;
      const kept = cachedRecent.results.filter((g) => g.siteType !== siteKey);
      const merged = [...kept, ...freshResults].sort((a, b) => {
        const da = a.date ? new Date(a.date as string).getTime() : 0;
        const db = b.date ? new Date(b.date as string).getTime() : 0;
        return db - da;
      });
      cachedRecent = {
        results: merged,
        timestamp: cachedRecent.timestamp,
        siteKey: cachedRecent.siteKey,
      };

      console.log(
        `[Recent] Per-site refresh done for ${siteName}: replaced ${prevCount} → ${freshResults.length} posts`
      );

      enrichInBackground();
      enrichAppIdsInBackground();
      prefetchImageBytesInBackground();
    } catch (err) {
      console.error(`[Recent] Per-site refresh error for ${siteName}:`, err);
    } finally {
      inflightSiteRefreshes.delete(siteKey);
    }
  })();

  return { started: true };
}

// ─── Reverify ──────────────────────────────────────────────────────────────

/**
 * Clear per-title failure cooldowns and both helper modules' negative
 * caches so every unverified title gets another IGDB/Steam attempt. Rate
 * limited by `REVERIFY_COOLDOWN_MS`. Returns `true` if the reverify was
 * actually executed.
 */
export function triggerReverify(reason: string, opts: { bypassCooldown?: boolean } = {}): boolean {
  const elapsed = Date.now() - lastReverifyAt;
  if (!opts.bypassCooldown && elapsed < REVERIFY_COOLDOWN_MS) return false;
  lastReverifyAt = Date.now();

  clearFailureCooldowns();
  const clearedAppIds = clearNegativeAppIdCache();
  const clearedImages = clearNegativeImageCache();
  console.log(
    `[Recent] Reverify triggered (${reason}) — cleared ` +
      `route cooldowns, resolver negatives: ${clearedAppIds}, image negatives: ${clearedImages}`
  );

  enrichInBackground();
  enrichAppIdsInBackground();
  return true;
}

// ─── Auto-recovery ─────────────────────────────────────────────────────────

export function runAutoRecovery(games: Game[]): AutoRecoveryReport {
  const stats = computeSiteStats(games);
  const emptySites = findEmptySiteKeys(stats);
  const overloadedSites = findOverloadedSiteKeys(stats);

  const refreshedSites: string[] = [];
  for (const siteKey of emptySites) {
    const { started } = refreshSiteInBackground(siteKey, { reason: 'empty-site' });
    if (started) refreshedSites.push(siteKey);
  }

  const reverifyTriggered =
    overloadedSites.length > 0 &&
    triggerReverify(
      `overloaded sites: ${overloadedSites
        .map(s => `${s}=${stats[s].verified}v/${stats[s].unverified}u`)
        .join(', ')}`
    );

  return { stats, emptySites, overloadedSites, refreshedSites, reverifyTriggered };
}
