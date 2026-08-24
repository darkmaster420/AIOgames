/**
 * Server-to-server access to the Python backend's cs.rin.ru scraper.
 *
 * The Node csrin parser (lib/gameapi/helpers.js) targets phpBB3 and never worked
 * against the live rinDark forum, so anything that needs real csrin data —
 * search results, recent uploads, update-check candidates — must go through the
 * FastAPI backend, which owns the forum login + parsing. Reached on the
 * unpublished backend port with the shared internal key, exactly like the Next
 * middleware's proxy.
 */

const BACKEND_URL = (process.env.BACKEND_INTERNAL_URL || 'http://aiogames-backend:8000').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.INTERNAL_API_SECRET || '';

export interface CsrinPost {
  id: string;
  title: string;
  originalTitle?: string;
  link: string;
  date?: string;
  source: string;
  siteType: string;
  image?: string | null;
  description?: string;
  downloadLinks?: Array<{ url: string; label?: string; service?: string; type?: string; text?: string }>;
  csrinReleaseLabel?: string;
  csrinFullTitle?: string;
  csrinOnlineFix?: boolean;
  csrinReliablePoster?: boolean;
  csrinUntrustedPoster?: boolean;
  [key: string]: unknown;
}

async function backendGet(path: string): Promise<CsrinPost[]> {
  if (!INTERNAL_KEY) return [];
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      headers: { 'x-aio-internal-key': INTERNAL_KEY },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[csrinBackend] ${path} returned ${res.status}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.results) ? (data.results as CsrinPost[]) : [];
  } catch (err) {
    console.warn(`[csrinBackend] ${path} failed:`, err);
    return [];
  }
}

/** Recent cs.rin.ru Game Releases (the home feed source). */
export function fetchCsrinRecentFromBackend(refresh = false): Promise<CsrinPost[]> {
  return backendGet(`/api/games/csrin-recent${refresh ? '?refresh=true' : ''}`);
}

/** Search cs.rin.ru for a specific game (used to find update candidates). */
export function fetchCsrinSearchFromBackend(query: string): Promise<CsrinPost[]> {
  const q = (query || '').trim();
  if (!q) return Promise.resolve([]);
  return backendGet(`/api/games/search?site=csrin&search=${encodeURIComponent(q)}`);
}

export interface PostDetailsResponse {
  success: boolean;
  post?: CsrinPost;
  error?: string;
}

/**
 * A single post WITH download links (the getPostDetails path). Used by the Next
 * /api/games/links route for skidrow; csrin links are embedded in search/recent
 * results, so csrin never hits this.
 */
export async function fetchPostDetailsFromBackend(siteType: string, postId: string): Promise<PostDetailsResponse> {
  if (!INTERNAL_KEY) return { success: false, error: 'no internal key' };
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/games/post-details?site=${encodeURIComponent(siteType)}&post_id=${encodeURIComponent(postId)}`,
      { headers: { 'x-aio-internal-key': INTERNAL_KEY }, cache: 'no-store' },
    );
    if (!res.ok) return { success: false, error: `backend ${res.status}` };
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Multi-site search across the ported scrapers (skidrow + csrin). `sites` is the
 * requested filter; omit / empty means the backend's default set (skidrow only,
 * csrin opt-in). Used by the Next search route, which keeps its own AppID
 * enrichment + term filter + cache on top of these raw results.
 */
export function fetchGamesSearchFromBackend(query: string, sites?: string[]): Promise<CsrinPost[]> {
  const q = (query || '').trim();
  if (!q) return Promise.resolve([]);
  const siteParam = sites && sites.length ? `&site=${encodeURIComponent(sites.join(','))}` : '';
  return backendGet(`/api/games/search?search=${encodeURIComponent(q)}${siteParam}`);
}

/**
 * Normalise a csrin release label ("buildID: 123", "BUILD 123") to "Build 123"
 * so the shared version engine's build regex (`\bbuild[\s\-#.]?(\d+)`) matches.
 */
export function normalizeCsrinLabel(label: string | undefined | null): string {
  return (label || '')
    .replace(/^\s*build\s*id\s*:?\s*/i, 'Build ')
    .replace(/^\s*build\s*:?\s*/i, 'Build ')
    .trim();
}

/**
 * csrin cards carry a clean game title with the version held separately, but the
 * update-check reads the version from the title (extractVersionInfo). Fold the
 * normalised label back into the title so both version detection AND title
 * similarity (cleanGameTitle strips the label again) work. Returns a shallow
 * copy safe to merge into the candidate pool.
 */
export function withVersionBearingTitle(post: CsrinPost): CsrinPost {
  const label = normalizeCsrinLabel(post.csrinReleaseLabel);
  if (!label) return post;
  const title = `${post.title} ${label}`;
  return { ...post, title, originalTitle: title };
}
