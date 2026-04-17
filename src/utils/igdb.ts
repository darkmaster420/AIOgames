// IGDB (Internet Game Database) integration
// For finding unreleased and upcoming games that aren't on piracy sites yet

interface IGDBGame {
  id: number;
  name: string;
  summary?: string;
  cover?: {
    id: number;
    url: string;
  };
  first_release_date?: number;
  release_dates?: Array<{
    id: number;
    date: number;
    platform: number;
    region: number;
  }>;
  genres?: Array<{
    id: number;
    name: string;
  }>;
  platforms?: Array<{
    id: number;
    name: string;
  }>;
  url?: string;
}

interface IGDBSearchResult {
  id: string;
  title: string;
  description: string;
  image?: string;
  releaseDate?: string;
  genres?: string[];
  platforms?: string[];
  url?: string;
}

export type { IGDBSearchResult };

const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID;
const IGDB_ACCESS_TOKEN = process.env.IGDB_ACCESS_TOKEN;

async function getIGDBToken(): Promise<string> {
  if (IGDB_ACCESS_TOKEN) {
    return IGDB_ACCESS_TOKEN;
  }

  // If no stored token, get a new one using Client Credentials flow
  const clientId = IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('IGDB credentials not configured. Please set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables.');
  }

  const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to get IGDB access token');
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

export async function searchIGDB(query: string): Promise<IGDBSearchResult[]> {
  try {
    const accessToken = await getIGDBToken();
    const clientId = IGDB_CLIENT_ID;

    if (!clientId) {
      throw new Error('IGDB_CLIENT_ID not configured');
    }

    console.log(`[IGDB] Searching for: "${query}"`);

    // Try multiple search approaches for better results
    const searchApproaches = [
      // Approach 1: Basic search with minimal filters
      {
        name: 'basic_search',
        query: `search "${query}"; fields name,summary,cover.url,first_release_date,release_dates.date,release_dates.platform,genres.name,platforms.name,url; limit 10;`
      },
      // Approach 2: Name-based wildcard search (most flexible)
      {
        name: 'wildcard_search',
        query: `fields name,summary,cover.url,first_release_date,release_dates.date,release_dates.platform,genres.name,platforms.name,url; where name ~ *"${query}"*; limit 10;`
      },
      // Approach 3: Exact name search 
      {
        name: 'exact_search',
        query: `fields name,summary,cover.url,first_release_date,release_dates.date,release_dates.platform,genres.name,platforms.name,url; where name = "${query}"; limit 10;`
      },
      // Approach 4: Search with category filter (main games only)
      {
        name: 'category_filtered',
        query: `search "${query}"; fields name,summary,cover.url,first_release_date,release_dates.date,release_dates.platform,genres.name,platforms.name,url; where category = 0; limit 10;`
      }
    ];

    // eslint-disable-next-line prefer-const
    let allResults: IGDBGame[] = [];

    for (const approach of searchApproaches) {
      try {
        console.log(`[IGDB] Trying ${approach.name} approach...`);
        
        const response = await fetch('https://api.igdb.com/v4/games', {
          method: 'POST',
          headers: {
            'Client-ID': clientId,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'text/plain',
          },
          body: approach.query,
        });

        if (!response.ok) {
          console.log(`[IGDB] ${approach.name} failed: ${response.status} ${response.statusText}`);
          continue;
        }

        const games: IGDBGame[] = await response.json();
        console.log(`[IGDB] ${approach.name} returned ${games.length} results`);
        
        if (games.length > 0) {
          // Add unique games to results (avoid duplicates)
          const newGames = games.filter(game => 
            !allResults.some(existing => existing.id === game.id)
          );
          allResults.push(...newGames);
          
          // If we found results with the basic or category search, use those primarily
          if (approach.name === 'basic_search' || approach.name === 'category_filtered') {
            break;
          }
        }
      } catch (err) {
        console.log(`[IGDB] ${approach.name} error:`, err);
        continue;
      }
    }

    console.log(`[IGDB] Total unique results found: ${allResults.length}`);

    const results = allResults.map(game => ({
      id: `igdb_${game.id}`,
      title: game.name,
      description: game.summary || 'No description available',
      image: game.cover?.url ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
      releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString() : undefined,
      genres: game.genres?.map(g => g.name) || [],
      platforms: game.platforms?.map(p => p.name) || [],
      url: game.url
    }));

    // Log the results for debugging
    results.forEach((game, index) => {
      console.log(`[IGDB] Result ${index + 1}: "${game.title}" (ID: ${game.id})`);
    });

    return results;

  } catch (error) {
    console.error('IGDB search error:', error);
    return [];
  }
}

export async function getIGDBGameDetails(igdbId: number): Promise<IGDBSearchResult | null> {
  try {
    const accessToken = await getIGDBToken();
    const clientId = IGDB_CLIENT_ID;

    if (!clientId) {
      throw new Error('IGDB_CLIENT_ID not configured');
    }

    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: `
        where id = ${igdbId};
        fields name,summary,cover.url,first_release_date,release_dates.date,release_dates.platform,genres.name,platforms.name,url;
        limit 1;
      `,
    });

    if (!response.ok) {
      throw new Error(`IGDB API error: ${response.status} ${response.statusText}`);
    }

    const games: IGDBGame[] = await response.json();
    
    if (games.length === 0) {
      return null;
    }

    const game = games[0];
    return {
      id: `igdb_${game.id}`,
      title: game.name,
      description: game.summary || 'No description available',
      image: game.cover?.url ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
      releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString() : undefined,
      genres: game.genres?.map(g => g.name) || [],
      platforms: game.platforms?.map(p => p.name) || [],
      url: game.url
    };

  } catch (error) {
    console.error('IGDB game details error:', error);
    return null;
  }
}

// Lightweight image-only cache: title → cover URL
const gameImageCache = new Map<string, { url: string; timestamp: number }>();
const IGDB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for IGDB results
const RAWG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 week for RAWG results (20k req/month limit)

const RAWG_API_KEY = process.env.RAWG_API_KEY;

/**
 * Try RAWG.io as a fallback image source.
 * Results cached for 1 week to conserve the 20k monthly request limit.
 */
async function resolveRAWGImage(title: string): Promise<string | null> {
  if (!RAWG_API_KEY) return null;

  try {
    const response = await fetch(
      `https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(title)}&page_size=3`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!response.ok) {
      console.warn(`[RAWG] Search failed for "${title}": ${response.status}`);
      return null;
    }

    const data: { results: { name: string; background_image: string | null }[] } = await response.json();
    const withImage = data.results?.find(g => g.background_image);
    if (withImage?.background_image) {
      console.log(`[RAWG] Resolved image for "${title}": ${withImage.name}`);
      return withImage.background_image;
    }
    return null;
  } catch (err) {
    console.warn(`[RAWG] Error for "${title}":`, err);
    return null;
  }
}

/**
 * Resolve a game image — tries IGDB first, then RAWG as fallback.
 * Only successful results are cached. Failures retry every request.
 */
export async function resolveIGDBImage(title: string): Promise<string | null> {
  const cacheKey = title.toLowerCase().trim();
  if (!cacheKey) return null;

  // Check cache (uses the longer TTL of the two sources)
  const cached = gameImageCache.get(cacheKey);
  if (cached) {
    const ttl = cached.url.includes('rawg.io') ? RAWG_CACHE_TTL : IGDB_CACHE_TTL;
    if ((Date.now() - cached.timestamp) < ttl) {
      return cached.url;
    }
  }

  // --- Try IGDB first ---
  const accessToken = await getIGDBToken();
  const clientId = IGDB_CLIENT_ID;

  if (clientId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('https://api.igdb.com/v4/games', {
          method: 'POST',
          headers: {
            'Client-ID': clientId,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'text/plain',
          },
          body: `search "${title}"; fields name,cover.url; limit 5;`,
        });

        if (response.status === 429) {
          const wait = Math.pow(2, attempt + 1) * 1000;
          console.warn(`[IGDB] Rate limited for "${title}", waiting ${wait}ms (attempt ${attempt + 1}/3)`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }

        if (!response.ok) {
          console.warn(`[IGDB] Image resolve failed for "${title}": ${response.status}`);
          break; // Fall through to RAWG
        }

        const games: { id: number; name: string; cover?: { url: string } }[] = await response.json();
        const withCover = games.find(g => g.cover?.url);
        const imageUrl = withCover?.cover?.url
          ? `https:${withCover.cover.url.replace('t_thumb', 't_cover_big')}`
          : null;

        if (imageUrl) {
          console.log(`[IGDB] Resolved image for "${title}": ${withCover?.name}`);
          gameImageCache.set(cacheKey, { url: imageUrl, timestamp: Date.now() });
          return imageUrl;
        }
        break; // No cover found on IGDB, fall through to RAWG
      } catch (err) {
        if (attempt === 2) {
          console.warn(`[IGDB] Image resolve error for "${title}" after 3 attempts:`, err);
          break; // Fall through to RAWG
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // --- Fallback to RAWG ---
  const rawgImage = await resolveRAWGImage(title);
  if (rawgImage) {
    gameImageCache.set(cacheKey, { url: rawgImage, timestamp: Date.now() });
    return rawgImage;
  }

  return null;
}