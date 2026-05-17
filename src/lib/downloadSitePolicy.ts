/** Shown when users request download links for DODI-Repacks tracked games. */
export const DODI_FOLLOW_POST_NOTICE =
  'DODI-Repacks downloads are not listed here. Open the original post on DODI-Repacks to get magnet links and installers.';

export function isDodiSiteType(siteType: string | null | undefined): boolean {
  return (siteType || '').trim().toLowerCase() === 'dodi';
}

export function resolveTrackedGameSiteType(game: {
  gameId?: string;
  source?: string;
  gameLink?: string;
}): string | null {
  if (game.gameId) {
    const m = String(game.gameId).match(/^([a-z]+)_/i);
    if (m) return m[1].toLowerCase();
  }
  const link = (game.gameLink || '').toLowerCase();
  if (link.includes('dodi-repacks')) return 'dodi';
  const src = (game.source || '').toLowerCase();
  if (src.includes('dodi')) return 'dodi';
  return null;
}

export function isDodiTrackedGame(game: {
  gameId?: string;
  source?: string;
  gameLink?: string;
}): boolean {
  return isDodiSiteType(resolveTrackedGameSiteType(game));
}

export function buildDodiFollowPostDownloadResponse(game: {
  title?: string;
  gameLink?: string;
  lastKnownVersion?: string;
}) {
  return {
    downloadLinks: [] as [],
    totalLinks: 0,
    notice: DODI_FOLLOW_POST_NOTICE,
    noticeType: 'follow_post' as const,
    context: {
      gameTitle: game.title || 'Unknown',
      currentVersion: game.lastKnownVersion || 'Latest',
      type: 'dodi-follow-post',
      postUrl: game.gameLink || '',
      source: 'dodi',
    },
  };
}
