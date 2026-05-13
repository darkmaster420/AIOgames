import mongoose from 'mongoose';
import connectDB from './db';
import { getPostDetails } from './gameapi';
import { TrackedGame } from './models';

export type TrackedDownloadLink = {
  service: string;
  url: string;
  type?: string;
};

/**
 * Prefer latestApprovedUpdate links when non-empty; otherwise the newest
 * updateHistory entry that has download links; otherwise rssCachedDownloadLinks.
 * (Empty [] must not block fallback.)
 */
export function collectStoredDownloadLinks(game: {
  latestApprovedUpdate?: { downloadLinks?: TrackedDownloadLink[] };
  updateHistory?: Array<{
    dateFound?: string | Date;
    downloadLinks?: TrackedDownloadLink[];
  }>;
  rssCachedDownloadLinks?: TrackedDownloadLink[];
}): TrackedDownloadLink[] {
  const approved = game.latestApprovedUpdate?.downloadLinks;
  if (Array.isArray(approved) && approved.length > 0) {
    return approved.map(l => ({ ...l }));
  }

  if (!game.updateHistory?.length) {
    const cachedOnly = game.rssCachedDownloadLinks;
    if (Array.isArray(cachedOnly) && cachedOnly.length > 0) {
      return cachedOnly.map(l => ({ ...l }));
    }
    return [];
  }

  const sorted = [...game.updateHistory].sort(
    (a, b) =>
      new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
  );
  const row = sorted.find(
    u => Array.isArray(u.downloadLinks) && u.downloadLinks.length > 0
  );
  if (row?.downloadLinks?.length) {
    return row.downloadLinks.map(l => ({ ...l }));
  }

  const cached = game.rssCachedDownloadLinks;
  if (Array.isArray(cached) && cached.length > 0) {
    return cached.map(l => ({ ...l }));
  }

  return [];
}

type DownloadLinkSourceGame = {
  latestApprovedUpdate?: {
    dateFound?: string | Date;
    downloadLinks?: TrackedDownloadLink[];
  };
  updateHistory?: Array<{
    dateFound?: string | Date;
    downloadLinks?: TrackedDownloadLink[];
  }>;
  rssCachedDownloadLinks?: TrackedDownloadLink[];
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
export function mergeDownloadLinksForRss(game: DownloadLinkSourceGame): TrackedDownloadLink[] {
  const seen = new Set<string>();
  const out: TrackedDownloadLink[] = [];

  const push = (arr?: TrackedDownloadLink[] | null) => {
    if (!Array.isArray(arr)) return;
    for (const l of arr) {
      const u = (l.url || '').trim();
      if (!u) continue;
      const key = u.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        service: typeof l.service === 'string' && l.service.trim() ? l.service.trim() : 'download',
        url: l.url,
        type: l.type
      });
    }
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
  return out;
}

type GameapiGameShape = {
  gameId?: string;
  gameLink?: string;
  updateHistory?: Array<{
    dateFound?: string | Date;
    gameLink?: string;
    downloadLinks?: TrackedDownloadLink[];
  }>;
};

/**
 * Same postId/siteType resolution as /api/games/downloads when DB has no links.
 */
export async function fetchDownloadLinksViaGameapi(
  game: GameapiGameShape
): Promise<TrackedDownloadLink[]> {
  let postId: string | null = null;
  let siteType: string | null = null;

  if (game.gameId) {
    const gameIdMatch = game.gameId.match(/^([a-z]+)_(.+)$/);
    if (gameIdMatch) {
      [, siteType, postId] = gameIdMatch;
    }
  }

  if (!postId || !siteType) {
    let targetUrl: string | null = null;
    if (game.updateHistory && game.updateHistory.length > 0) {
      const latestUpdate = [...game.updateHistory].sort(
        (a, b) =>
          new Date(b.dateFound || 0).getTime() - new Date(a.dateFound || 0).getTime()
      )[0];
      if (latestUpdate.gameLink) targetUrl = latestUpdate.gameLink;
    }
    if (!targetUrl && game.gameLink) {
      targetUrl = game.gameLink;
    }

    if (targetUrl) {
      const apiMatch = targetUrl.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
      if (apiMatch) {
        postId = apiMatch[1];
      }
      if (!postId) {
        const queryMatch = targetUrl.match(/[?&]p=(\d+)/);
        if (queryMatch) postId = queryMatch[1];
      }
      if (!postId) {
        const pathMatch = targetUrl.match(/\/(\d+)\/?$/);
        if (pathMatch) postId = pathMatch[1];
      }

      const domainMatch = targetUrl.match(/https?:\/\/([^/]+)/);
      if (domainMatch) {
        const domain = domainMatch[1];
        if (domain.includes('gamedrive')) siteType = 'gamedrive';
        else if (domain.includes('skidrowreloaded')) siteType = 'skidrow';
        else if (domain.includes('freegogpcgames')) siteType = 'freegog';
        else if (domain.includes('steamrip')) siteType = 'steamrip';
        else if (domain.includes('reloadedsteam')) siteType = 'reloadedsteam';
        else if (domain.includes('steamunderground')) siteType = 'steamunderground';
      }
    }
  }

  if (!postId || !siteType) return [];

  try {
    const gameapiData = await getPostDetails(postId, siteType);
    if (gameapiData.success && gameapiData.post?.downloadLinks?.length) {
      return gameapiData.post.downloadLinks.map(
        (link: { service: string; url: string; type: string }) => ({
          service: link.service,
          url: link.url,
          type: link.type
        })
      );
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
  /** Max games to process in one batch (default 20, capped at 150). */
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
      rssCachedDownloadLinks: 1,
      rssDownloadLinksFetchedAt: 1,
      latestApprovedUpdate: 1,
      updateHistory: { $slice: -40 },
    })
    .sort({ rssDownloadLinksFetchedAt: 1 })
    .limit(fetchLimit)
    .lean();

  const toWarm = candidates
    .filter(g => needsRssDownloadLinkWarm(g as DownloadLinkSourceGame, maxAgeMs))
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
