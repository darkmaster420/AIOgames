/**
 * Session-scoped cache for the discovery grid.
 *
 * Opening a game and pressing back remounts the home page, which used to refetch
 * the whole feed. Until that request landed the grid was empty, so there was
 * nothing to scroll back to and the browser dropped the user at the top; every
 * card then remounted and re-decoded its poster, which reads as the images
 * reloading even though they are served from the HTTP cache.
 *
 * Holding the last rendered feed plus its scroll offset in sessionStorage makes
 * back-navigation instant and puts the user where they left off. It is
 * per-tab and cleared when the tab closes, which is the right lifetime: it is a
 * navigation aid, not a data cache. The server remains the source of truth —
 * anything older than the TTL, or an explicit Refresh, re-fetches.
 */

const STORAGE_PREFIX = 'aiogames:home-feed:';
const TTL_MS = 15 * 60 * 1000;

type CachedFeed<T> = {
  games: T[];
  scrollY: number;
  savedAt: number;
};

/**
 * Identifies a distinct feed, so search results and the default recent list do
 * not overwrite one another when the user moves between them.
 */
export function buildHomeFeedKey(
  searchQuery: string,
  selectedSites: string[],
  refineText: string,
): string {
  return [
    searchQuery.trim().toLowerCase(),
    [...selectedSites].sort().join('+'),
    refineText.trim().toLowerCase(),
  ].join('|');
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readRaw<T>(key: string): CachedFeed<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFeed<T>;
    if (!parsed || !Array.isArray(parsed.games)) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      window.sessionStorage.removeItem(storageKey(key));
      return null;
    }
    return parsed;
  } catch {
    // Corrupt entry or storage disabled — behave as a cache miss.
    return null;
  }
}

export function readHomeFeed<T>(key: string): { games: T[]; scrollY: number } | null {
  const cached = readRaw<T>(key);
  if (!cached || cached.games.length === 0) return null;
  return { games: cached.games, scrollY: cached.scrollY };
}

export function writeHomeFeed<T>(key: string, games: T[]): void {
  if (typeof window === 'undefined' || games.length === 0) return;
  try {
    const payload: CachedFeed<T> = { games, scrollY: 0, savedAt: Date.now() };
    window.sessionStorage.setItem(storageKey(key), JSON.stringify(payload));
  } catch {
    // Over quota or storage unavailable. Dropping the cache only costs the
    // restore, so there is nothing useful to do about it.
  }
}

/** Records the scroll offset against an existing entry, leaving the games alone. */
export function saveHomeFeedScroll(key: string, scrollY: number): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return;
    const parsed = JSON.parse(raw) as CachedFeed<unknown>;
    parsed.scrollY = scrollY;
    window.sessionStorage.setItem(storageKey(key), JSON.stringify(parsed));
  } catch {
    // Same as above: losing the offset is not worth surfacing.
  }
}

/** Drops every cached feed. Used when the user explicitly asks for fresh data. */
export function clearHomeFeedCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach(k => window.sessionStorage.removeItem(k));
  } catch {
    // Nothing to do.
  }
}
