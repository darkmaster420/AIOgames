import mongoose from 'mongoose';
import connectDB from './db';
import { getPostDetails, searchGames } from './gameapi';
import { TrackedGame } from './models';
import { isFollowPostTrackedGame, isFollowPostSiteType } from './downloadSitePolicy';
import { normalizeDownloadLinks, type DownloadLinkLike } from './downloadLinks';
import { cleanGameTitle } from '../utils/steamApi';

export type TrackedDownloadLink = {
  service: string;
  url: string;
  type?: string;
};

/**
 * Prefer latestApprovedUpdate links when non-empty; otherwise the newest
 * updateHistory entry that has download links; otherwise rssCachedDownloadLinks.
 * (Empty [] must not block fallback.)
 *
 * Every branch goes through `normalizeDownloadLinks`, which reads fields
 * explicitly — spreading these entries is unsafe because callers may pass a
 * hydrated mongoose document, whose subdocuments spread to internal state
 * instead of `service`/`url`/`type`.
 */
export function collectStoredDownloadLinks(game: {
  gameId?: string;
  source?: string;
  gameLink?: string;
  latestApprovedUpdate?: { downloadLinks?: DownloadLinkLike[] };
  updateHistory?: Array<{
    dateFound?: string | Date;
    downloadLinks?: DownloadLinkLike[];
  }>;
  rssCachedDownloadLinks?: DownloadLinkLike[];
}): TrackedDownloadLink[] {
  if (isFollowPostTrackedGame(game)) {
    return [];
  }

  const approved = normalizeDownloadLinks(game.latestApprovedUpdate?.downloadLinks);
  if (approved.length > 0) {
    return approved;
  }

  if (game.updateHistory?.length) {
    const sorted = [...game.updateHistory].sort(
      (a, b) =>
        new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
    );
    for (const row of sorted) {
      const links = normalizeDownloadLinks(row.downloadLinks);
      if (links.length > 0) return links;
    }
  }

  return normalizeDownloadLinks(game.rssCachedDownloadLinks);
}

type DownloadLinkSourceGame = {
  latestApprovedUpdate?: {
    dateFound?: string | Date;
    downloadLinks?: DownloadLinkLike[];
  };
  updateHistory?: Array<{
    dateFound?: string | Date;
    downloadLinks?: DownloadLinkLike[];
  }>;
  rssCachedDownloadLinks?: DownloadLinkLike[];
  rssDownloadLinksFetchedAt?: string | Date;
};

/** Latest timestamp where we received download links or an approved update (post may have changed). */
export function getRssDownloadLinksAnchorMs(game: DownloadLinkSourceGame): number | null {
  const times: number[] = [];
  const la = game.latestApprovedUpdate;
  if (
    la?.dateFound &&
    Array.isArray(la.downloadLinks) &&
    la.downloadLinks.length > 0
  ) {
    const n = new Date(la.dateFound).getTime();
    if (Number.isFinite(n)) times.push(n);
  }
  if (game.updateHistory?.length) {
    const sorted = [...game.updateHistory].sort(
      (a, b) =>
        new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
    );
    for (const row of sorted.slice(0, 40)) {
      if (Array.isArray(row.downloadLinks) && row.downloadLinks.length > 0 && row.dateFound) {
        const n = new Date(row.dateFound).getTime();
        if (Number.isFinite(n)) times.push(n);
      }
    }
  }
  if (!times.length) return null;
  return Math.max(...times);
}

/**
 * True when `rssCachedDownloadLinks` should not be trusted for the current post
 * (fetched before the latest update that carries download metadata).
 */
export function isRssDownloadCacheStale(game: DownloadLinkSourceGame): boolean {
  if (!Array.isArray(game.rssCachedDownloadLinks) || game.rssCachedDownloadLinks.length === 0) {
    return false;
  }
  const fetchedRaw = game.rssDownloadLinksFetchedAt;
  const fetched = fetchedRaw ? new Date(fetchedRaw).getTime() : NaN;
  if (!Number.isFinite(fetched)) return true;

  const anchor = getRssDownloadLinksAnchorMs(game);
  if (anchor === null) return false;
  return fetched < anchor;
}

/**
 * Union of all stored link lists (deduped by URL) for RSS only.
 * `collectStoredDownloadLinks` returns only the first non-empty source, which can hide
 * magnets on `rssCachedDownloadLinks` when `latestApprovedUpdate` has hoster-only links.
 *
 * Omits `rssCachedDownloadLinks` when it is older than the latest update that introduced
 * download metadata (so a new game version does not keep showing links from the previous post).
 */
export function mergeDownloadLinksForRss(
  game: DownloadLinkSourceGame & {
    gameId?: string;
    source?: string;
    gameLink?: string;
  }
): TrackedDownloadLink[] {
  if (isFollowPostTrackedGame(game)) {
    return [];
  }

  const collected: DownloadLinkLike[] = [];

  const push = (arr?: DownloadLinkLike[] | null) => {
    if (Array.isArray(arr)) collected.push(...arr);
  };

  push(game.latestApprovedUpdate?.downloadLinks);
  if (game.updateHistory?.length) {
    const sorted = [...game.updateHistory].sort(
      (a, b) =>
        new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
    );
    for (const row of sorted) {
      push(row.downloadLinks);
    }
  }
  if (!isRssDownloadCacheStale(game)) {
    push(game.rssCachedDownloadLinks);
  }

  // Deduping happens once at the end so the first occurrence (newest source) wins.
  return normalizeDownloadLinks(collected);
}

type GameapiGameShape = {
  gameId?: string;
  title?: string;
  originalTitle?: string;
  lastKnownVersion?: string;
  source?: string;
  gameLink?: string;
  latestApprovedUpdate?: {
    dateFound?: string | Date;
    gameLink?: string;
    siteType?: string;
    originalId?: string | number;
  };
  updateHistory?: Array<{
    dateFound?: string | Date;
    gameLink?: string;
    siteType?: string;
    originalId?: string | number;
    downloadLinks?: DownloadLinkLike[];
  }>;
};

const GAMEAPI_SITE_TYPES = new Set([
  'freegog',
  'fitgirl',
  'onlinefix',
  'reloadedsteam',
  'skidrow',
  'steamrip',
  'steamunderground',
]);

function normalizeSiteType(value?: string | null): string | null {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, string> = {
    freegogpcgames: 'freegog',
    fitgirlrepacks: 'fitgirl',
    onlinefix: 'onlinefix',
    reloadedsteam: 'reloadedsteam',
    skidrowreloaded: 'skidrow',
    steamrip: 'steamrip',
    steamunderground: 'steamunderground',
  };
  const siteType = aliases[normalized] || normalized;
  return GAMEAPI_SITE_TYPES.has(siteType) ? siteType : null;
}

function siteTypeFromUrl(targetUrl?: string | null): string | null {
  if (!targetUrl) return null;
  const domain = targetUrl.match(/https?:\/\/([^/]+)/)?.[1]?.toLowerCase() || '';
  if (domain.includes('skidrowreloaded')) return 'skidrow';
  if (domain.includes('online-fix') || domain.includes('onlinefix')) return 'onlinefix';
  if (domain.includes('freegogpcgames')) return 'freegog';
  if (domain.includes('steamrip')) return 'steamrip';
  if (domain.includes('reloadedsteam')) return 'reloadedsteam';
  if (domain.includes('steamunderground')) return 'steamunderground';
  if (domain.includes('fitgirl-repacks')) return 'fitgirl';
  return null;
}

function postIdFromUrl(targetUrl?: string | null): string | null {
  if (!targetUrl) return null;
  return targetUrl.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/)?.[1]
    || targetUrl.match(/[?&]p=(\d+)/)?.[1]
    || targetUrl.match(/\/(\d+)\/?$/)?.[1]
    || null;
}

function latestSourceRow(game: GameapiGameShape) {
  const rows = [
    ...(game.latestApprovedUpdate ? [game.latestApprovedUpdate] : []),
    ...(game.updateHistory || []),
  ];
  return rows.sort((a, b) =>
    new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
  )[0];
}

function resolveGameapiPostSource(game: GameapiGameShape): { postId: string | null; siteType: string; targetUrl: string | null } | null {
  let postId: string | null = null;
  let siteType: string | null = null;
  const latest = latestSourceRow(game);
  const targetUrl = latest?.gameLink || game.gameLink || null;

  siteType = normalizeSiteType(latest?.siteType) || siteTypeFromUrl(targetUrl);
  postId = latest?.originalId ? String(latest.originalId) : postIdFromUrl(targetUrl);

  if ((!postId || !siteType) && game.gameId) {
    const gameIdMatch = game.gameId.match(/^([a-z]+)_(.+)$/);
    const gameIdSite = normalizeSiteType(gameIdMatch?.[1]);
    if (gameIdMatch && gameIdSite && (!siteType || siteType === gameIdSite)) {
      siteType ||= gameIdSite;
      // A slug URL can point at a newer post on the same site while gameId
      // still references the previously tracked post. Resolve slug URLs by
      // exact search below; only trust gameId when there is no current URL.
      if (!targetUrl) postId ||= gameIdMatch[2];
    }
  }

  siteType ||= normalizeSiteType(game.source);
  if (!siteType) return null;
  return { postId, siteType, targetUrl };
}

export function canFetchDownloadLinksViaGameapi(game: GameapiGameShape): boolean {
  return !isFollowPostTrackedGame(game) && resolveGameapiPostSource(game) !== null;
}

/**
 * Same postId/siteType resolution as /api/games/downloads when DB has no links.
 */
export async function fetchDownloadLinksViaGameapi(
  game: GameapiGameShape
): Promise<TrackedDownloadLink[]> {
  const source = resolveGameapiPostSource(game);
  if (!source) return [];

  if (isFollowPostSiteType(source.siteType)) {
    return [];
  }

  try {
    let postId = source.postId;

    // Older tracked rows may have a new slug URL but a stale composite gameId
    // from the previous source. Recover the real post id by searching the
    // current site and matching the exact source URL.
    if (!postId && source.targetUrl) {
      const searchTitle = cleanGameTitle(
        game.originalTitle || game.lastKnownVersion || game.title || ''
      ).trim();
      if (searchTitle) {
        const searchResult = await searchGames(searchTitle, source.siteType);
        const normalizedTarget = source.targetUrl.replace(/\/+$/, '').toLowerCase();
        const exactPost = searchResult.results?.find(result =>
          String(result.link || '').replace(/\/+$/, '').toLowerCase() === normalizedTarget
        );
        postId = exactPost?.originalId
          ? String(exactPost.originalId)
          : String(exactPost?.id || '').split('_')[1] || null;
      }
    }

    if (!postId) return [];
    const gameapiData = await getPostDetails(postId, source.siteType);
    if (gameapiData.success && gameapiData.post?.downloadLinks?.length) {
      return normalizeDownloadLinks(gameapiData.post.downloadLinks);
    }
  } catch {
    // non-fatal for RSS / callers
  }
  return [];
}

/**
 * Fetches download links via gameapi and stores them on the tracked game for RSS
 * (so feed reads never fan out to gameapi).
 */
export async function syncRssDownloadLinksCache(trackedGameId: string): Promise<boolean> {
  const id = trackedGameId?.trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return false;

  const game = await TrackedGame.findById(id).lean();
  if (!game) return false;
  if (!canFetchDownloadLinksViaGameapi(game as GameapiGameShape)) return false;

  if (isFollowPostTrackedGame(game as GameapiGameShape)) {
    return false;
  }

  const links = await fetchDownloadLinksViaGameapi(game as GameapiGameShape);
  if (!links.length) return false;

  await TrackedGame.updateOne(
    { _id: id },
    { $set: { rssCachedDownloadLinks: links, rssDownloadLinksFetchedAt: new Date() } }
  );
  return true;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type WarmRssDownloadLinksCacheOptions = {
  /** Max games to process in one batch (default 20 for API; scheduler caps at 10). Hard cap 150. */
  maxGames?: number;
  /** Pause between gameapi calls to avoid bursting upstream (default 450ms). */
  delayMs?: number;
  /** When set, only games for this Mongo user id string. */
  userId?: string;
  /**
   * When set, also re-fetch games whose `rssDownloadLinksFetchedAt` is older than this many ms,
   * so RSS links stay reasonably fresh.
   */
  maxAgeMs?: number;
};

function needsRssDownloadLinkWarm(
  game: DownloadLinkSourceGame,
  maxAgeMs?: number
): boolean {
  const empty = !Array.isArray(game.rssCachedDownloadLinks) || game.rssCachedDownloadLinks.length === 0;
  if (empty) return true;

  if (typeof maxAgeMs === 'number' && maxAgeMs > 0 && game.rssDownloadLinksFetchedAt) {
    const fetched = new Date(game.rssDownloadLinksFetchedAt).getTime();
    if (Number.isFinite(fetched) && fetched < Date.now() - maxAgeMs) return true;
  }

  return isRssDownloadCacheStale(game);
}

/**
 * Background job: fill `rssCachedDownloadLinks` for tracked games that are missing it
 * (and optionally refresh stale caches). Sequential + delay to be polite to gameapi.
 */
export async function warmRssDownloadLinksCacheBatch(
  options: WarmRssDownloadLinksCacheOptions = {}
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const maxGames = Math.min(Math.max(options.maxGames ?? 20, 1), 150);
  const delayMs = Math.max(options.delayMs ?? 450, 0);
  const { userId, maxAgeMs } = options;

  await connectDB();

  const hasSource = {
    $or: [
      { gameLink: { $exists: true, $nin: [null, ''] } },
      { gameId: { $exists: true, $nin: [null, ''] } },
    ],
  };

  const filter: Record<string, unknown> = {
    isActive: true,
    $and: [
      hasSource,
      {
        $or: [
          { rssCachedDownloadLinks: { $exists: false } },
          { rssCachedDownloadLinks: { $eq: [] } },
          { 'rssCachedDownloadLinks.0': { $exists: true } },
        ],
      },
    ],
  };

  if (userId?.trim()) {
    filter.userId = userId.trim();
  }

  const fetchLimit = Math.min(maxGames * 12, 240);

  const candidates = await TrackedGame.find(filter)
    .select({
      _id: 1,
      gameId: 1,
      gameLink: 1,
      rssCachedDownloadLinks: 1,
      rssDownloadLinksFetchedAt: 1,
      latestApprovedUpdate: 1,
      updateHistory: { $slice: -40 },
    })
    .sort({ rssDownloadLinksFetchedAt: 1 })
    .limit(fetchLimit)
    .lean();

  const toWarm = candidates
    .filter(g =>
      canFetchDownloadLinksViaGameapi(g as GameapiGameShape) &&
      needsRssDownloadLinkWarm(g as DownloadLinkSourceGame, maxAgeMs)
    )
    .slice(0, maxGames);

  let succeeded = 0;
  let failed = 0;
  for (const row of toWarm) {
    const id = String(row._id);
    const ok = await syncRssDownloadLinksCache(id);
    if (ok) succeeded += 1;
    else failed += 1;
    if (delayMs > 0) await sleepMs(delayMs);
  }

  return { attempted: toWarm.length, succeeded, failed };
}
