/**
 * Require every whitespace-separated token from the user's query to appear in
 * a game's searchable text (original title, display title, excerpt, etc.).
 */

export type SearchableGameFields = {
  title?: string;
  originalTitle?: string;
  excerpt?: string;
  description?: string;
};

/** Split query into non-empty terms (preserves tokens like `0xdeadcode`). */
export function parseSearchQueryTerms(query: string): string[] {
  return String(query || '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function getSearchableGameText(game: SearchableGameFields): string {
  return [game.originalTitle, game.title, game.excerpt, game.description]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

export function gameMatchesAllSearchTerms(
  game: SearchableGameFields,
  terms: string[]
): boolean {
  if (terms.length === 0) return true;
  const haystack = getSearchableGameText(game);
  if (!haystack) return false;
  return terms.every(term => haystack.includes(term));
}

export function filterGamesBySearchQuery<T extends SearchableGameFields>(
  games: T[],
  query: string
): T[] {
  const terms = parseSearchQueryTerms(query);
  if (terms.length === 0) return games;
  return games.filter(game => gameMatchesAllSearchTerms(game, terms));
}
