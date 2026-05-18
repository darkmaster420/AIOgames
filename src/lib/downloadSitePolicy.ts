// Some sites we surface in search results don't have machine-extractable
// download links - either because they're forums (cs.rin.ru) where each
// thread's download method varies post-by-post, or because they actively
// rotate / obfuscate links (DODI-Repacks). For these, we deliberately
// return zero download links and ask the user to open the original post.

type FollowPostConfig = {
  /** Slug used for telemetry / context.source on the response payload. */
  source: string;
  /** Sentence shown to the user explaining why we don't list links here. */
  notice: string;
  /** Button label to send users to the original post/thread. */
  buttonLabel: string;
};

const FOLLOW_POST_SITES: Record<string, FollowPostConfig> = {
  dodi: {
    source: 'dodi',
    notice:
      'DODI-Repacks downloads are not listed here. Open the original post on DODI-Repacks to get magnet links and installers.',
    buttonLabel: 'Open post on DODI-Repacks',
  },
  csrin: {
    source: 'csrin',
    notice:
      'cs.rin.ru links live inside the forum thread itself, which is updated by community members. Open the thread to find the latest downloads and discussion.',
    buttonLabel: 'Open thread on cs.rin.ru',
  },
};

function normalizeSiteType(siteType: string | null | undefined): string {
  return (siteType || '').trim().toLowerCase();
}

export function isFollowPostSiteType(siteType: string | null | undefined): boolean {
  return normalizeSiteType(siteType) in FOLLOW_POST_SITES;
}

export function resolveTrackedGameSiteType(game: {
  gameId?: string;
  source?: string;
  gameLink?: string;
}): string | null {
  // Prefer the gameId prefix (e.g. "skidrow_12345", "csrin-155283") since
  // it's stamped at fetch time. Supports both `_` and `-` as separators.
  if (game.gameId) {
    const m = String(game.gameId).match(/^([a-z]+)[-_]/i);
    if (m) return m[1].toLowerCase();
  }
  const link = (game.gameLink || '').toLowerCase();
  if (link.includes('dodi-repacks')) return 'dodi';
  if (link.includes('cs.rin.ru')) return 'csrin';
  const src = (game.source || '').toLowerCase();
  if (src.includes('dodi')) return 'dodi';
  if (src.includes('cs.rin') || src.includes('csrin')) return 'csrin';
  return null;
}

export function isFollowPostTrackedGame(game: {
  gameId?: string;
  source?: string;
  gameLink?: string;
}): boolean {
  return isFollowPostSiteType(resolveTrackedGameSiteType(game));
}

export function buildFollowPostDownloadResponse(
  game: { title?: string; gameLink?: string; lastKnownVersion?: string },
  siteType: string | null | undefined,
) {
  const key = normalizeSiteType(siteType);
  const cfg = FOLLOW_POST_SITES[key];
  if (!cfg) {
    // Defensive default - callers should only invoke this for sites known
    // to be in the policy set, but a typo shouldn't crash the route.
    return {
      downloadLinks: [] as [],
      totalLinks: 0,
      notice: 'Downloads are not listed here. Open the original post for links.',
      noticeType: 'follow_post' as const,
      noticeButtonLabel: 'Open original post',
      context: {
        gameTitle: game.title || 'Unknown',
        currentVersion: game.lastKnownVersion || 'Latest',
        type: 'follow-post',
        postUrl: game.gameLink || '',
        source: key || 'unknown',
      },
    };
  }
  return {
    downloadLinks: [] as [],
    totalLinks: 0,
    notice: cfg.notice,
    noticeType: 'follow_post' as const,
    noticeButtonLabel: cfg.buttonLabel,
    context: {
      gameTitle: game.title || 'Unknown',
      currentVersion: game.lastKnownVersion || 'Latest',
      type: `${cfg.source}-follow-post`,
      postUrl: game.gameLink || '',
      source: cfg.source,
    },
  };
}

// ── Back-compat exports ──────────────────────────────────────────────────
// Old DODI-specific helpers kept so existing callsites compile until they
// migrate to the generic forms above.

/** @deprecated Use buildFollowPostDownloadResponse + cfg lookup. */
export const DODI_FOLLOW_POST_NOTICE = FOLLOW_POST_SITES.dodi.notice;

/** @deprecated Use isFollowPostSiteType. */
export function isDodiSiteType(siteType: string | null | undefined): boolean {
  return normalizeSiteType(siteType) === 'dodi';
}

/** @deprecated Use isFollowPostTrackedGame. */
export function isDodiTrackedGame(game: {
  gameId?: string;
  source?: string;
  gameLink?: string;
}): boolean {
  return isDodiSiteType(resolveTrackedGameSiteType(game));
}

/** @deprecated Use buildFollowPostDownloadResponse(game, 'dodi'). */
export function buildDodiFollowPostDownloadResponse(game: {
  title?: string;
  gameLink?: string;
  lastKnownVersion?: string;
}) {
  return buildFollowPostDownloadResponse(game, 'dodi');
}
