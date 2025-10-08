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

    // Search for games using IGDB API
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: `
        search "${query}";
        fields name,summary,cover.url,first_release_date,release_dates.date,release_dates.platform,genres.name,platforms.name,url;
        limit 10;
        where category = 0;
      `,
    });

    if (!response.ok) {
      throw new Error(`IGDB API error: ${response.status} ${response.statusText}`);
    }

    const games: IGDBGame[] = await response.json();

    return games.map(game => ({
      id: `igdb_${game.id}`,
      title: game.name,
      description: game.summary || 'No description available',
      image: game.cover?.url ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
      releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString() : undefined,
      genres: game.genres?.map(g => g.name) || [],
      platforms: game.platforms?.map(p => p.name) || [],
      url: game.url
    }));

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
        'Content-Type': 'application/json',
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