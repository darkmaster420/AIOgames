// Steam API utility functions
// Uses the integrated Steam API at /api/steam
// The AI endpoint remains as a separate Cloudflare Worker

interface SteamGameResult {
  appid: string;
  name: string;
  type: 'game' | 'dlc' | 'demo' | 'beta' | 'tool';
  short_description?: string;
  detailed_description?: string;
  header_image?: string;
  website?: string;
  developers?: string[];
  publishers?: string[];
  price_overview?: {
    currency: string;
    initial: number;
    final: number;
    discount_percent: number;
    initial_formatted: string;
    final_formatted: string;
  };
  release_date?: {
    coming_soon: boolean;
    date: string;
  };
  metacritic?: {
    score: number;
    url: string;
  };
  screenshots?: Array<{
    id: number;
    path_thumbnail: string;
    path_full: string;
  }>;
  // SteamSpy data when available
  owners?: string;
  owners_variance?: number;
  players_forever?: number;
  players_forever_variance?: number;
  players_2weeks?: number;
  players_2weeks_variance?: number;
  average_forever?: number;
  average_2weeks?: number;
  median_forever?: number;
  median_2weeks?: number;
  ccu?: number;
  score_rank?: string;
  positive?: number;
  negative?: number;
  userscore?: number;
  tags?: Record<string, number>;
}

interface SteamSearchResponse {
  query: string;
  results: SteamGameResult[];
  total: number;
  source: 'steamspy' | 'steam' | 'hybrid';
  cached: boolean;
}

interface SteamApiError {
  error: string;
  message?: string;
  details?: unknown;
}

// Use local integrated Steam API instead of external worker
// In browser/Next.js context, use relative URL. In Node.js, need absolute URL.
const getDefaultBase = () => {
  // If running in browser/Next.js, use relative URL
  if (typeof window !== 'undefined') {
    return '/api/steam';
  }
  // In Node.js (e.g., tests, scripts), default to localhost
  return process.env.NEXT_PUBLIC_APP_URL 
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/steam`
    : 'http://localhost:3002/api/steam';
};

export const STEAM_API_BASE =
  (typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_STEAM_API_BASE || process.env.STEAM_API_BASE)) ||
  getDefaultBase();
const REQUEST_TIMEOUT = 10000; // 10 seconds
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
// Shorter TTL for frequently changing builds from SteamDB via Worker
const BUILDS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// In-memory cache for Steam API responses
const steamCache = new Map<string, { data: unknown; timestamp: number; ttl: number }>();

/**
 * Generic fetch wrapper with timeout and error handling
 */
async function steamApiFetch(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AIOgames-App/1.0',
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData: SteamApiError = await response.json().catch(() => ({
        error: 'HTTP Error',
        message: `Status: ${response.status} ${response.statusText}`
      }));
      throw new Error(`Steam API Error: ${errorData.error} - ${errorData.message}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Steam API request timeout');
      }
      throw error;
    }
    
    throw new Error('Unknown Steam API error');
  }
}

/**
 * Check cache for a given key
 */
function getCachedResult(key: string): unknown | null {
  const cached = steamCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }
  if (cached) {
    steamCache.delete(key); // Remove expired cache
  }
  return null;
}

/**
 * Store result in cache
 */
function setCacheResult(key: string, data: unknown, ttl: number = CACHE_TTL): void {
  steamCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
}

// Types for aggregated /appid details from the Worker
export interface SteamDbBuildItem {
  guid: string; // e.g., "build#20193388"
  build_id: string; // e.g., "20193388"
  version?: string | null; // heuristic version extracted by the Worker
  title?: string;
  url?: string;
  description?: string;
  thumbnail?: string | null;
  published_at?: string; // RFC 822 from RSS
}

export interface SteamAppAggregatedDetails {
  appid: string;
  name?: string;
  sources?: Record<string, unknown> & {
    steamdb?: { rss_url?: string; item_count?: number };
  };
  builds?: SteamDbBuildItem[];
  latest_build?: SteamDbBuildItem | null;
}

/**
 * Fetch aggregated details (including SteamDB builds/versions) for a Steam App ID
 * Uses the integrated Steam API /api/steam endpoint.
 */
export async function getSteamAppDetails(appId: string | number): Promise<SteamAppAggregatedDetails> {
  if (!appId) throw new Error('App ID cannot be empty');

  const normalizedId = String(appId).trim();
  const cacheKey = `appid:${normalizedId}`;
  const cached = getCachedResult(cacheKey);
  if (cached) return cached as SteamAppAggregatedDetails;

  const url = `${STEAM_API_BASE}?action=appid&id=${encodeURIComponent(normalizedId)}`;
  const data = await steamApiFetch(url) as SteamAppAggregatedDetails;

  // Cache with shorter TTL since builds change more often
  setCacheResult(cacheKey, data, BUILDS_CACHE_TTL);
  return data;
}

/** Normalize version strings like "v1.2.3" -> "1.2.3" */
export function normalizeVersionString(version: string): string {
  return String(version).trim().replace(/^v\s*/i, '');
}

/**
 * Resolve a SteamDB build ID for a given version string using the Worker's aggregated builds
 */
export async function resolveBuildFromVersion(appId: string | number, version: string): Promise<string | null> {
  const normalized = normalizeVersionString(version);
  if (!normalized) return null;

  function getShortVersion(ver: string): string | null {
    // Extract major.minor.patch (e.g., 0.6.7 from 0.6.7.79736)
    const m = ver.match(/\d+\.\d+(?:\.\d+)?/);
    return m ? m[0] : null;
  }

  try {
    const details = await getSteamAppDetails(appId);
    const builds = details.builds || [];
    // 1) Prefer explicit version field match
    let byField = builds.find(b => (b.version || '').toLowerCase() === normalized.toLowerCase());
    if (byField?.build_id) return byField.build_id;
    // 2) Fallback to title/description contains
    let patterns = [normalized, `v${normalized}`];
    let byText = builds.find(b => {
      const hay = `${b.title || ''} ${b.description || ''}`.toLowerCase();
      return patterns.some(p => hay.includes(p.toLowerCase()));
    });
    if (byText?.build_id) return byText.build_id;

    // 3) Fallback: try with short version (major.minor.patch)
    const shortVersion = getShortVersion(normalized);
    if (shortVersion && shortVersion !== normalized) {
      byField = builds.find(b => (b.version || '').toLowerCase() === shortVersion.toLowerCase());
      if (byField?.build_id) return byField.build_id;
      patterns = [shortVersion, `v${shortVersion}`];
      byText = builds.find(b => {
        const hay = `${b.title || ''} ${b.description || ''}`.toLowerCase();
        return patterns.some(p => hay.includes(p.toLowerCase()));
      });
      if (byText?.build_id) return byText.build_id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a version string for a given SteamDB build ID using the Worker's aggregated builds
 */
export async function resolveVersionFromBuild(appId: string | number, buildId: string | number): Promise<string | null> {
  const target = String(buildId).trim();
  if (!target) return null;
  try {
    const details = await getSteamAppDetails(appId);
    const builds = details.builds || [];
    const found = builds.find(b => String(b.build_id) === target);
    if (!found) return null;
    if (found.version) return normalizeVersionString(found.version);
    // Fallback: try to extract from title/description like "v1.2.3" or "1.2.3"
    const text = `${found.title || ''} ${found.description || ''}`;
    const m = text.match(/v?(\d+\.\d+(?:\.\d+){0,2})/i);
    return m ? normalizeVersionString(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Search for games by name using Steam API Worker
 * @param query - Game name to search for
 * @param limit - Maximum number of results (default: 10)
 * @returns Promise<SteamSearchResponse>
 */
export async function searchSteamGames(query: string, limit: number = 10): Promise<SteamSearchResponse> {
  if (!query.trim()) {
    throw new Error('Search query cannot be empty');
  }

  const cacheKey = `search:${query.toLowerCase().trim()}:${limit}`;
  const cached = getCachedResult(cacheKey);
  if (cached) {
    return { ...(cached as SteamSearchResponse), cached: true };
  }

  try {
    const encodedQuery = encodeURIComponent(query.trim());
    const url = `${STEAM_API_BASE}?action=search&q=${encodedQuery}`;
    
    const response = await steamApiFetch(url) as {
      results?: SteamGameResult[];
      total?: number;
      source?: string;
    };
    
    const result: SteamSearchResponse = {
      query: query.trim(),
      results: response.results || [],
      total: response.total || 0,
      source: (response.source as 'steamspy' | 'steam' | 'hybrid') || 'steam',
      cached: false
    };

    // Cache successful responses
    setCacheResult(cacheKey, result);
    
    return result;
    
  } catch (error) {
    console.error(`Steam API search error for "${query}":`, error);
    throw error;
  }
}

/**
 * Get game details by Steam App ID
 * @param appId - Steam application ID
 * @returns Promise<SteamGameResult>
 */
export async function getSteamGameById(appId: string | number): Promise<SteamGameResult> {
  if (!appId) {
    throw new Error('App ID cannot be empty');
  }

  const cacheKey = `game:${appId}`;
  const cached = getCachedResult(cacheKey);
  if (cached) {
    return cached as SteamGameResult;
  }

  try {
    const url = `${STEAM_API_BASE}/search?q=${appId}`;
    
    const response = await steamApiFetch(url) as {
      results?: SteamGameResult[];
    };
    
    if (!response.results || response.results.length === 0) {
      throw new Error(`Game with App ID ${appId} not found`);
    }

    const game = response.results[0];
    
    // Cache successful responses
    setCacheResult(cacheKey, game);
    
    return game;
    
  } catch (error) {
    console.error(`Steam API get game error for ID "${appId}":`, error);
    throw error;
  }
}

/**
 * Enhanced game matching using Steam API
 * Finds the best matches for a given game title from Steam's database
 * @param gameTitle - Game title to match against
 * @param threshold - Minimum similarity threshold (0-1)
 * @param limit - Maximum number of results to return
 * @returns Promise<Array<SteamGameResult & { similarity: number }>>
 */
export async function findSteamMatches(
  gameTitle: string, 
  threshold: number = 0.6, 
  limit: number = 5
): Promise<Array<SteamGameResult & { similarity: number; confidence: number }>> {
  if (!gameTitle.trim()) {
    throw new Error('Game title cannot be empty');
  }

  try {
    // Search for games
    const searchResponse = await searchSteamGames(gameTitle, limit * 2);
    
    if (searchResponse.results.length === 0) {
      return [];
    }

    // Calculate similarity scores and filter
    const matches = searchResponse.results
      .map(game => ({
        ...game,
        similarity: calculateGameSimilarity(gameTitle, game.name),
        confidence: calculateConfidence(gameTitle, game)
      }))
      .filter(game => game.similarity >= threshold)
      .sort((a, b) => {
        // Sort by confidence first, then similarity
        if (Math.abs(a.confidence - b.confidence) > 0.1) {
          return b.confidence - a.confidence;
        }
        return b.similarity - a.similarity;
      })
      .slice(0, limit);

    // Steam matches found above threshold
    
    return matches;
    
  } catch (error) {
    console.error(`Steam match finding error for "${gameTitle}":`, error);
    return [];
  }
}

/**
 * Public function to clean and normalize game titles
 * @param title - Raw game title to clean
 * @returns Cleaned and normalized title
 */
export function cleanGameTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove comprehensive piracy/release tags first - most common scene groups
    .replace(/\b(denuvoless|cracked|repack|fitgirl|dodi|empress|codex|skidrow|plaza|rune|tenoke|p2p)\b/gi, '')
    .replace(/\b(cpy|steampunks|ali213|3dm|reloaded|razor1911|prophet|hoodlum|fairlight)\b/gi, '')
    .replace(/\b(darksiders|masquerade|goldberg|ova\sgames|simplex|darkzer0)\b/gi, '')
    .replace(/\b(chronos|flt|unleashed|deviance|vitality|outlaws|tinyiso)\b/gi, '')
    
    // Remove release format indicators
    .replace(/\b(free download|full version|complete edition|full game)\b/gi, '')
    .replace(/\b(portable|standalone|multilanguage|multi\slang|english only)\b/gi, '')
    .replace(/\b(gog\sversion|steam\sversion|epic\sversion|origin\sversion)\b/gi, '')
    .replace(/\b(drm\sfree|no\sdrm|steam\srip|gog\srip)\b/gi, '')
    
    // Remove DLC and content indicators  
    .replace(/\b(all dlc|with dlc|dlc included|\+\s*all\s*dlc|\+\s*dlc|dlc pack)\b/gi, '')
    .replace(/\b(season pass|deluxe content|bonus content|soundtrack included)\b/gi, '')
    .replace(/\b(psn\s*bonus|playstation\s*bonus|steam\s*bonus|epic\s*bonus|gog\s*bonus)\b/gi, '') // Platform bonuses
    .replace(/\b(pre-?order\s*bonus|preorder\s*bonus|pre-?purchase\s*bonus)\b/gi, '') // Pre-order bonuses
    .replace(/\bdlc\b/gi, '') // Remove standalone DLC tag
    .replace(/\b(expansion pack|expansion|add-on content|add-on|addon|content pack|character pack)\b/gi, "") // Additional content indicators
    
    // Remove installation and format tags
    .replace(/\b(pre-installed|preinstalled|pre\sinstalled)\b/gi, '')
    .replace(/\b(setup|installer|direct\splay|ready\sto\splay)\b/gi, '')
    .replace(/\b(compressed|highly compressed|small size)\b/gi, '')
    .replace(/\b(update \d+|hotfix|patch|day\s?\d+\s?patch)\b/gi, '')
    
    // Remove quality and source indicators
    .replace(/\b(hd|4k|uhd|full\shd|1080p|720p|480p)\b/gi, '')
    .replace(/\b(bluray|blu\sray|dvd\srip|web\srip|cam\srip)\b/gi, '')
    
    // Remove size and format info
    .replace(/\b\d+(\.\d+)?\s?(gb|mb|tb)\b/gi, '') // Remove size info like "5.2 GB"
    .replace(/\b(iso|rar|zip|7z|part\d+)\b/gi, '') // Remove archive formats
    
    // Remove release status and development stage indicators that can mess up matching
    .replace(/\b(early access|early-access)\b/gi, '')
    .replace(/\b(beta|alpha|preview|demo|prototype)\b/gi, '')
    .replace(/\b(early release|early version)\b/gi, '')
    .replace(/\b(closed beta|open beta|public beta)\b/gi, '')
    .replace(/\b(test build|test version|testing)\b/gi, '')
    .replace(/\b(pre-alpha|pre-beta|pre-release)\b/gi, '')
    .replace(/\b(developer build|dev build|internal)\b/gi, '')
    .replace(/\b(work in progress|wip)\b/gi, '')
    .replace(/\b(coming soon|unreleased)\b/gi, '')
    .replace(/\b(steam deck verified|deck verified)\b/gi, '')
    
    // Remove complex version patterns FIRST - more aggressive cleaning
    .replace(/v\d+(\.\d+){3,}(-[A-Z0-9]+)?/gi, '') // v2013.012.003.008.007-P2P or v1.218.0.0
    .replace(/v\d+(?:\.\d+)*(?:\.[a-z]|[a-z])?(?:-[A-Z0-9]+)?/gi, '') // v1.2.3, v1.2.3.a, v1.2.3c, v1.33.a-CODEX
    .replace(/\bversion\s*\d+(?:\.\d+)*(?:\.[a-z]|[a-z])?/gi, '') // version 1.2.3, version 1.2.a, version 1.2.3c
    .replace(/\bver\.?\s*\d+(?:\.\d+)*(?:\.[a-z]|[a-z])?/gi, '') // ver 1.2, ver. 1.2.a, ver 1.2.3c
    .replace(/\bbuild\s*#?\d+/gi, '') // build 20035145, build #123
    .replace(/\bb\d{4,}/gi, '') // b20035145 (build numbers)
    .replace(/\bupdate\s*\d+(\.\d+)*/gi, '') // update 1.5
    .replace(/\brev\s*\d+/gi, '') // rev 123, revision numbers
    .replace(/\brelease\s*\d+/gi, '') // release 1, release 2
    .replace(/\br\d+/gi, '') // r123 (revision format)
    .replace(/\b20\d{2}[-\.]\d{1,2}[-\.]\d{1,2}/gi, '') // Date formats 2024-01-15, 2024.1.15
    .replace(/\b\d{8}/gi, '') // Date formats 20240115
    
    // Remove year tags like (2025), [2024] etc - but preserve years that are part of game names
    .replace(/\(20\d{2}\)/g, '') // (2025)
    .replace(/\[20\d{2}\]/g, '') // [2024]
    
    // Remove + symbols and surrounding content more aggressively
    .replace(/\s*\+\s*[^+]*$/gi, '') // Remove everything after the first + symbol
    .replace(/\s*\+\s*/g, ' ') // Replace remaining + with spaces
    
    // Remove scene groups - comprehensive pattern matching
    .replace(/-[A-Z0-9]{3,}$/gi, '') // Scene groups at end like -RUNE, -TENOKE
    .replace(/-[A-Z0-9]{3,}\s/gi, ' ') // Scene groups in middle
    .replace(/\b[A-Z0-9]{3,}-$/gi, '') // Alternative scene group format
    .replace(/\[(CODEX|PLAZA|SKIDROW|EMPRESS|FITGIRL|DODI|RUNE|TENOKE|CPY|ALI213|3DM|RELOADED|RAZOR1911|PROPHET|HOODLUM|FAIRLIGHT|SIMPLEX|DARKZER0|CHRONOS|FLT|UNLEASHED|DEVIANCE|VITALITY|OUTLAWS|TINYISO)\]/gi, '') // Bracketed scene groups
    .replace(/\([A-Z0-9]{3,}\)/gi, '') // Parenthetical scene groups
    
    // Remove bracketed/parenthetical content (after year removal to avoid conflicts)
    .replace(/\[[^\]]*\]/g, '')    
    .replace(/\([^)]*\)/g, '')     
    
    // Remove trademark symbols
    .replace(/[®™©]/g, '')
    
    // Remove orphaned version letters ONLY if they appear to be version suffixes
    // This preserves actual words like "beast" while removing version patterns
    .replace(/\s+v?\d+(\.\d+)*[a-h](?=\s|$)/gi, '') // Remove version patterns ending with letters like "v1.2.3c"
    .replace(/(?<=\s|^)v[a-h](?=\s|$)/gi, '') // Remove standalone version letters like "va", "vb" etc
    .replace(/(?<=\d\s+)[a-h](?=\s|$)/gi, '') // Remove version letters that follow numbers like "1 a", "123 b"
    
    // IMPORTANT: Keep "ZERO" as "zero" when it's likely part of a game name
    // Only convert isolated "0" to "zero" when appropriate
    // This preserves "Dragon Ball Sparking ZERO" while handling numbered sequels
    .replace(/\b(dragon\s+ball\s+sparking)\s+0\b/gi, '$1 zero') // Special case for Dragon Ball
    
    // Normalize other number words to numbers for better matching
    .replace(/\bone\b/gi, '1')
    .replace(/\btwo\b/gi, '2')
    .replace(/\bthree\b/gi, '3')
    .replace(/\bfour\b/gi, '4')
    .replace(/\bfive\b/gi, '5')
    .replace(/\bsix\b/gi, '6')
    .replace(/\bseven\b/gi, '7')
    .replace(/\beight\b/gi, '8')
    .replace(/\bnine\b/gi, '9')
    
    // Normalize common variations
    .replace(/\band\b/gi, '&')
    .replace(/\bvs\.?\b/gi, 'vs')
    .replace(/\bof the\b/gi, 'of')
    
    // Normalize apostrophes and dashes
    .replace(/[']/g, '')           // Remove apostrophes (Assassin's -> Assassins)
    .replace(/[-:]/g, ' ')         // Convert dashes/colons to spaces
    
    // Remove special characters and normalize
    .replace(/[^\w\s&]/g, ' ')       
    .replace(/\s+/g, ' ')          
    .trim();
}

/**
 * Detect if a release is from 0xdeadcode (known for online fixes)
 */
export function is0xdeadcodeRelease(title: string): boolean {
  return /\b0xdeadcode\b/i.test(title);
}

/**
 * Extract release group from title
 */
export function extractReleaseGroup(title: string): string | null {
  // Check for 0xdeadcode first
  if (is0xdeadcodeRelease(title)) {
    return '0xdeadcode';
  }
  
  // Look for scene groups in various formats
  const scenePatterns = [
    /-([A-Z0-9]{3,})$/i,  // -CODEX, -RUNE, etc at end
    /\[([A-Z0-9]{3,})\]/i, // [CODEX] in brackets
    /\(([A-Z0-9]{3,})\)/i, // (CODEX) in parentheses
  ];
  
  for (const pattern of scenePatterns) {
    const match = title.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  
  return null;
}

/**
 * Enhanced game title cleaning that preserves edition information
 * Use this for better edition distinction while still allowing basic matching
 */
export function cleanGameTitlePreserveEdition(title: string): string {
  return title
    .toLowerCase()
    // Remove comprehensive piracy/release tags first - most common scene groups
    .replace(/\b(denuvoless|cracked|repack|fitgirl|dodi|empress|codex|skidrow|plaza|rune|tenoke|p2p)\b/gi, '')
    .replace(/\b(cpy|steampunks|ali213|3dm|reloaded|razor1911|prophet|hoodlum|fairlight)\b/gi, '')
    .replace(/\b(darksiders|masquerade|goldberg|ova\sgames|simplex|darkzer0)\b/gi, '')
    .replace(/\b(chronos|flt|unleashed|deviance|vitality|outlaws|tinyiso)\b/gi, '')
    
    // Remove release format indicators
    .replace(/\b(free download|full version|complete edition|full game)\b/gi, '')
    .replace(/\b(portable|standalone|multilanguage|multi\slang|english only)\b/gi, '')
    .replace(/\b(gog\sversion|steam\sversion|epic\sversion|origin\sversion)\b/gi, '')
    .replace(/\b(drm\sfree|no\sdrm|steam\srip|gog\srip)\b/gi, '')
    
    // Remove DLC and content indicators  
    .replace(/\b(all dlc|with dlc|dlc included|\+\s*dlc|dlc pack)\b/gi, '')
    .replace(/\b(season pass|deluxe content|bonus content|soundtrack included)\b/gi, '')
    .replace(/\bdlc\b/gi, '') // Remove standalone DLC tag
    .replace(/\b(expansion pack|expansion|add-on content|add-on|addon|content pack|character pack)\b/gi, "") // Additional content indicators
    
    // Remove installation and format tags
    .replace(/\b(pre-installed|preinstalled|pre\sinstalled)\b/gi, '')
    .replace(/\b(setup|installer|direct\splay|ready\sto\splay)\b/gi, '')
    .replace(/\b(compressed|highly compressed|small size)\b/gi, '')
    .replace(/\b(update \d+|hotfix|patch|day\s?\d+\s?patch)\b/gi, '')
    
    // Remove quality and source indicators
    .replace(/\b(hd|4k|uhd|full\shd|1080p|720p|480p)\b/gi, '')
    .replace(/\b(bluray|blu\sray|dvd\srip|web\srip|cam\srip)\b/gi, '')
    
    // Remove size and format info
    .replace(/\b\d+(\.\d+)?\s?(gb|mb|tb)\b/gi, '') // Remove size info like "5.2 GB"
    .replace(/\b(iso|rar|zip|7z|part\d+)\b/gi, '') // Remove archive formats
    
    // Remove release status and development stage indicators that can mess up matching
    .replace(/\b(early access|early-access)\b/gi, '')
    .replace(/\b(beta|alpha|preview|demo|prototype)\b/gi, '')
    .replace(/\b(early release|early version)\b/gi, '')
    .replace(/\b(closed beta|open beta|public beta)\b/gi, '')
    .replace(/\b(test build|test version|testing)\b/gi, '')
    .replace(/\b(pre-alpha|pre-beta|pre-release)\b/gi, '')
    .replace(/\b(developer build|dev build|internal)\b/gi, '')
    .replace(/\b(work in progress|wip)\b/gi, '')
    .replace(/\b(coming soon|unreleased)\b/gi, '')
    .replace(/\b(steam deck verified|deck verified)\b/gi, '')
    
    // Remove DLC, add-on content, and bonus material indicators
    .replace(/\b(character pack \d*|dlc pack \d*|expansion pack \d*)\b/gi, '')
    .replace(/\b(pre-purchase bonus|pre-order bonus|bonus content)\b/gi, '')
    .replace(/\b(\+\s*all dlc|\+ dlc|with all dlc)\b/gi, '')
    .replace(/\b(season pass|dlc bundle)\b/gi, '')
    
    // PRESERVE edition information - only remove redundant "edition" word
    .replace(/\s+edition\b/gi, '') // "Deluxe Edition" -> "Deluxe"
    
    // Remove complex version patterns - same as main function
    .replace(/v\d+(\.\d+){3,}-[A-Z0-9]+/gi, '') // v2013.012.003.008.007-P2P
    .replace(/v\d+(\.\d+){1,}-[A-Z0-9]+/gi, '') // v1.2-PLAZA, v1.2.3-CODEX
    .replace(/v\d+(\.\d+){2,}/gi, '') // v1.2.3.4 or longer
    .replace(/v\d+\.\d+/gi, '') // v1.2, v2.5 etc
    .replace(/\bversion\s*\d+(\.\d+)*/gi, '') // version 1.2.3
    .replace(/\bver\.?\s*\d+(\.\d+)*/gi, '') // ver 1.2 or ver. 1.2
    .replace(/\bbuild\s*\d+/gi, '') // build 20035145
    .replace(/\bb\d{4,}/gi, '') // b20035145 (build numbers)
    .replace(/\bupdate\s*\d+(\.\d+)*/gi, '') // update 1.5
    
    // Remove orphaned version letters at end of titles (like "Game Title C" from "Game Title v1.2.3c")
    .replace(/\s+[a-h]$/gi, '') // Remove common version letters a-h at end preceded by space
    .replace(/\s+[a-h]\s/gi, ' ') // Remove common version letters a-h in middle preceded and followed by space
    
    // Remove year tags like (2025), [2024] etc
    .replace(/\(20\d{2}\)/g, '') // (2025)
    .replace(/\[20\d{2}\]/g, '') // [2024]
    
    // Remove scene groups
    .replace(/-[A-Z0-9]{3,}$/gi, '') // Scene groups at end like -RUNE, -TENOKE
    .replace(/-[A-Z0-9]{3,}\s/gi, ' ') // Scene groups in middle
    
    // Remove bracketed/parenthetical content
    .replace(/\[[^\]]*\]/g, '')    
    .replace(/\([^)]*\)/g, '')     
    
    // Remove trademark symbols
    .replace(/[®™©]/g, '')
    
    // Keep version indicators as they're crucial for edition tracking
    // Don't remove versions - they help distinguish editions
    
    // IMPORTANT: Keep "ZERO" as "zero" when it's likely part of a game name
    .replace(/\b(dragon\s+ball\s+sparking)\s+0\b/gi, '$1 zero') // Special case for Dragon Ball
    
    // Normalize other number words
    .replace(/\bone\b/gi, '1')
    .replace(/\btwo\b/gi, '2')
    .replace(/\bthree\b/gi, '3')
    .replace(/\bfour\b/gi, '4')
    .replace(/\bfive\b/gi, '5')
    .replace(/\bsix\b/gi, '6')
    .replace(/\bseven\b/gi, '7')
    .replace(/\beight\b/gi, '8')
    .replace(/\bnine\b/gi, '9')
    
    // Normalize roman numerals to numbers
    .replace(/\bii\b/gi, '2')
    .replace(/\biii\b/gi, '3')
    .replace(/\biv\b/gi, '4')
    .replace(/\bv\b(?!\w)/gi, '5')
    .replace(/\bvi\b/gi, '6')
    .replace(/\bvii\b/gi, '7')
    .replace(/\bviii\b/gi, '8')
    .replace(/\bix\b/gi, '9')
    .replace(/\bx\b(?!\w)/gi, '10')
    
    // Normalize common variations
    .replace(/\band\b/gi, '&')
    .replace(/\bvs\.?\b/gi, 'vs')
    .replace(/\bof the\b/gi, 'of')
    
    // Normalize apostrophes and dashes
    .replace(/[']/g, '')
    .replace(/[-:]/g, ' ')
    
    // Remove special characters and normalize
    .replace(/[^\w\s&]/g, ' ')       
    .replace(/\s+/g, ' ')          
    .trim();
}

/**
 * Decode HTML entities to proper characters
 * @param text - Text containing HTML entities
 * @returns Decoded text with proper characters
 */
export function decodeHtmlEntities(text: string): string {
  if (typeof document !== 'undefined') {
    // Client-side: use DOM parser
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  } else {
    // Server-side: manual replacement of common entities
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#8211;/g, '–') // en dash
      .replace(/&#8212;/g, '—') // em dash
      .replace(/&#8216;/g, "'") // left single quotation mark
      .replace(/&#8217;/g, "'") // right single quotation mark
      .replace(/&#8220;/g, '"') // left double quotation mark
      .replace(/&#8221;/g, '"') // right double quotation mark
      .replace(/&#8230;/g, '…') // horizontal ellipsis
      .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
      .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

/**
 * Calculate similarity between two game titles
 * Enhanced version with improved normalization for number/word variations
 */
export function calculateGameSimilarity(title1: string, title2: string): number {
  const cleanTitle = cleanGameTitle;

  const clean1 = cleanTitle(title1);
  const clean2 = cleanTitle(title2);
  
  if (clean1 === clean2) return 1.0;
  
  // Enhanced normalization for better matching
  const normalize = (str: string) => {
    return str
      .toLowerCase()
      .replace(/[']/g, '')           // Remove apostrophes: "Marvel's" -> "Marvels"
      .replace(/[-:]/g, ' ')         // Convert dashes/colons to spaces: "Spider-Man" -> "Spider Man"
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim();
  };
  
  const norm1 = normalize(clean1);
  const norm2 = normalize(clean2);
  
  // Check normalized versions
  if (norm1 === norm2) return 1.0;
  
  // Exact substring matches (high score)
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const shorter = Math.min(norm1.length, norm2.length);
    const longer = Math.max(norm1.length, norm2.length);
    return Math.max(0.85, shorter / longer * 0.95); // Ensure high scores for substring matches
  }
  
  // Word-based similarity with enhanced scoring
  const words1 = norm1.split(/\s+/).filter(word => word.length > 0);
  const words2 = norm2.split(/\s+/).filter(word => word.length > 0);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  // Calculate exact word matches
  const exactMatches = words1.filter(word => words2.includes(word));
  
  // Calculate fuzzy matches for common variations
  let fuzzyMatches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (!exactMatches.includes(word1) && !exactMatches.includes(word2)) {
        // Check for partial matches on longer words
        if (word1.length >= 4 && word2.length >= 4) {
          if (word1.includes(word2) || word2.includes(word1)) {
            fuzzyMatches += 0.7; // Partial credit for fuzzy matches
            break;
          }
        }
        
        // Special handling for common variations
        if ((word1 === 'marvels' && word2 === 'marvel') || 
            (word1 === 'marvel' && word2 === 'marvels')) {
          fuzzyMatches += 0.9; // High score for possessive variations
          break;
        }
        
        // Handle number/word variations
        const numberWords = {
          '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
          '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten'
        };
        
        for (const [num, word] of Object.entries(numberWords)) {
          if ((word1 === num && word2 === word) || (word1 === word && word2 === num)) {
            fuzzyMatches += 0.95; // Very high score for number/word matches
            break;
          }
        }
      }
    }
  }
  
  const totalMatches = exactMatches.length + fuzzyMatches;
  const union = Array.from(new Set([...words1, ...words2]));
  const jaccard = totalMatches / union.length;
  
  // Boost score for games with similar word count
  const wordCountSimilarity = 1 - Math.abs(words1.length - words2.length) / Math.max(words1.length, words2.length);
  
  // Enhanced scoring with higher weight on word matches
  return Math.min(1.0, (jaccard * 0.85) + (wordCountSimilarity * 0.15));
}

/**
 * Calculate confidence score based on various factors
 */
function calculateConfidence(searchTitle: string, steamGame: SteamGameResult): number {
  let confidence = 0.5; // Base confidence
  
  // Boost for exact name match
  if (searchTitle.toLowerCase().trim() === steamGame.name.toLowerCase().trim()) {
    confidence += 0.4;
  }
  
  // Boost for games (vs DLC/demos)
  if (steamGame.type === 'game') {
    confidence += 0.2;
  }
  
  // Boost for games with good metadata
  if (steamGame.developers && steamGame.developers.length > 0) {
    confidence += 0.1;
  }
  
  if (steamGame.release_date && !steamGame.release_date.coming_soon) {
    confidence += 0.1;
  }
  
  // Boost for popular games (if SteamSpy data is available)
  if (steamGame.owners) {
    const ownersNum = parseInt(steamGame.owners.replace(/[^\d]/g, '')) || 0;
    if (ownersNum > 100000) confidence += 0.1;
    if (ownersNum > 1000000) confidence += 0.1;
  }
  
  // Boost for highly rated games
  if (steamGame.userscore && steamGame.userscore > 80) {
    confidence += 0.1;
  }
  
  if (steamGame.metacritic && steamGame.metacritic.score > 70) {
    confidence += 0.1;
  }
  
  return Math.min(confidence, 1.0); // Cap at 1.0
}

/**
 * Extract potential Steam App ID from various sources
 * @param text - Text that might contain a Steam App ID
 * @returns string | null
 */
export function extractSteamAppId(text: string): string | null {
  // Common Steam URL patterns
  const steamUrlPatterns = [
    /store\.steampowered\.com\/app\/(\d+)/i,
    /steamcommunity\.com\/app\/(\d+)/i,
    /steam:\/\/run\/(\d+)/i,
  ];
  
  for (const pattern of steamUrlPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  // Look for standalone App IDs (6-7 digit numbers)
  const appIdMatch = text.match(/\b(\d{6,7})\b/);
  if (appIdMatch) {
    return appIdMatch[1];
  }
  
  return null;
}

/**
 * Clear the Steam API cache (useful for testing or memory management)
 */
export function clearSteamCache(): void {
  steamCache.clear();
}

/**
 * Get cache statistics
 */
export function getSteamCacheStats(): { size: number; keys: string[] } {
  return {
    size: steamCache.size,
    keys: Array.from(steamCache.keys())
  };
}