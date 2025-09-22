// Steam API Worker utility functions
// Uses the Steam API Worker at https://steamapi.a7a8524.workers.dev

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

const STEAM_API_BASE = 'https://steamapi.a7a8524.workers.dev';
const REQUEST_TIMEOUT = 10000; // 10 seconds
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

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
    const url = `${STEAM_API_BASE}/search?q=${encodedQuery}&limit=${limit}`;
    
    console.log(`🎮 Searching Steam API for: "${query}"`);
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
    
    console.log(`🎮 Steam API search completed: ${result.results.length} results from ${result.source}`);
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
    
    console.log(`🎮 Getting Steam game by ID: ${appId}`);
    const response = await steamApiFetch(url) as {
      results?: SteamGameResult[];
    };
    
    if (!response.results || response.results.length === 0) {
      throw new Error(`Game with App ID ${appId} not found`);
    }

    const game = response.results[0];
    
    // Cache successful responses
    setCacheResult(cacheKey, game);
    
    console.log(`🎮 Steam game found: ${game.name} (${game.appid})`);
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

    console.log(`🎮 Steam matches for "${gameTitle}": ${matches.length} games above ${threshold} threshold`);
    
    return matches;
    
  } catch (error) {
    console.error(`Steam match finding error for "${gameTitle}":`, error);
    return [];
  }
}

/**
 * Calculate similarity between two game titles
 * Enhanced version of the existing similarity calculation
 */
function calculateGameSimilarity(title1: string, title2: string): number {
  const cleanTitle = (title: string) => {
    return title
      .toLowerCase()
      .replace(/-[A-Z0-9]{3,}/g, '') // Remove scene groups
      .replace(/\[[^\]]*\]/g, '')    // Remove bracketed content
      .replace(/\([^)]*\)/g, '')     // Remove parenthetical content
      .replace(/[®™©]/g, '')         // Remove trademark symbols
      .replace(/[^\w\s]/g, '')       // Remove special characters
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim();
  };

  const clean1 = cleanTitle(title1);
  const clean2 = cleanTitle(title2);
  
  if (clean1 === clean2) return 1.0;
  
  // Exact substring matches
  if (clean1.includes(clean2) || clean2.includes(clean1)) {
    const shorter = Math.min(clean1.length, clean2.length);
    const longer = Math.max(clean1.length, clean2.length);
    return shorter / longer * 0.9; // Slight penalty for partial matches
  }
  
  // Word-based similarity with weights
  const words1 = clean1.split(/\s+/).filter(word => word.length > 1);
  const words2 = clean2.split(/\s+/).filter(word => word.length > 1);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  // Calculate weighted Jaccard similarity
  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];
  const jaccard = intersection.length / union.length;
  
  // Boost score for games with similar word count
  const wordCountSimilarity = 1 - Math.abs(words1.length - words2.length) / Math.max(words1.length, words2.length);
  
  return (jaccard * 0.8) + (wordCountSimilarity * 0.2);
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
  console.log('🎮 Steam API cache cleared');
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