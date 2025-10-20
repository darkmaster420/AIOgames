import { NextRequest, NextResponse } from 'next/server';

// Steam API integration - provides Steam game data aggregation from multiple sources
// This replaces the SteamAPI worker for non-AI endpoints

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  try {
    // Search endpoint: /api/steam?action=search&q=game_name
    if (action === 'search') {
      const q = searchParams.get('q');
      if (!q) {
        return NextResponse.json(
          { error: 'missing query param q' },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      let results: Array<{
        appid: string;
        name: string;
        type: 'game' | 'dlc' | 'demo' | 'beta' | 'tool';
        developers?: string[];
        publishers?: string[];
        owners?: string;
        header_image?: string;
      }> = [];
      let source = 'steam_web_api';
      
      // If query is numeric, treat as appid lookup
      if (/^\d+$/.test(q)) {
        try {
          const data = await fetchSteamSpyAppDetails(q);
          if (data && data.name) {
            results = [{
              appid: q,
              name: data.name,
              type: 'game' as const,
              developers: data.developer ? [data.developer] : undefined,
              publishers: data.publisher ? [data.publisher] : undefined,
              owners: data.owners,
            }];
            source = 'steamspy';
          }
        } catch (error) {
          console.error('SteamSpy appid lookup error:', error);
        }
      } else {
        // Text search - try Steam Web API first (more reliable)
        try {
          const steamResults = await searchSteamWebAPI(q);
          if (steamResults && steamResults.length > 0) {
            results = steamResults;
            source = 'steam_web_api';
          }
        } catch (error) {
          console.error('Steam Web API search error:', error);
        }
        
        // Fallback to SteamSpy if Steam Web API failed
        if (results.length === 0) {
          try {
            const searchResults = await searchSteamSpyByName(q);
            if (searchResults && searchResults.length > 0) {
              results = searchResults;
              source = 'steamspy';
            }
          } catch (error) {
            console.error('SteamSpy search error:', error);
          }
        }
      }
      
      // Return in the format expected by steamApi.ts
      return NextResponse.json({
        query: q,
        results: results,
        total: results.length,
        source: source,
        cached: false
      }, { headers: CORS_HEADERS });
    }
    
    // App details endpoint: /api/steam?action=appid&id=12345
    if (action === 'appid') {
      const appid = searchParams.get('id') || searchParams.get('appid');
      if (!appid || !/^\d+$/.test(appid)) {
        return NextResponse.json(
          { error: 'missing or invalid appid' },
          { status: 400, headers: CORS_HEADERS }
        );
      }
      
      const [steamspy, steamRaw, rssXml] = await Promise.all([
        fetchSteamSpyAppDetails(appid),
        fetchSteamStoreDetails(appid),
        fetchSteamDBRss(appid),
      ]);

      const steamData = steamRaw && steamRaw[appid] && steamRaw[appid].success 
        ? steamRaw[appid].data 
        : null;
      
      const rssItems = parseSteamDBRss(rssXml);
      const builds = rssItems.map(simplifyPatchItem);

      const name = steamData?.name || steamspy?.name || null;

      return NextResponse.json({
        appid,
        name,
        sources: {
          steamspy,
          steam: steamData ? pickSteamFields(steamData) : null,
          steamdb: {
            rss_url: `https://steamdb.info/api/PatchnotesRSS/?appid=${appid}`,
            item_count: rssItems.length,
          },
        },
        builds,
        latest_build: builds[0] || null,
      }, { headers: CORS_HEADERS });
    }

    // Default response
    return NextResponse.json({
      message: 'Steam API Integration',
      endpoints: {
        search: '/api/steam?action=search&q=game_name',
        appid: '/api/steam?action=appid&id=12345',
      },
    }, { headers: CORS_HEADERS });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Steam API error:', error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// Helper functions

async function fetchSteamSpyAppDetails(appid: string) {
  const response = await fetch(
    `https://steamspy.com/api.php?request=appdetails&appid=${appid}`,
    { next: { revalidate: 3600 } } // Cache for 1 hour
  );
  return response.json();
}

async function fetchSteamStoreDetails(appid: string) {
  const response = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=US`,
    { next: { revalidate: 3600 } }
  );
  return response.json();
}

async function fetchSteamDBRss(appid: string) {
  const response = await fetch(
    `https://steamdb.info/api/PatchnotesRSS/?appid=${appid}`,
    { next: { revalidate: 3600 } }
  );
  return response.text();
}

async function searchSteamSpyByName(query: string) {
  try {
    const response = await fetch(
      `https://steamspy.com/api.php?request=search&query=${encodeURIComponent(query)}`,
      { 
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      }
    );
    
    if (!response.ok) {
      throw new Error(`SteamSpy API returned ${response.status}`);
    }
    
    const text = await response.text();
    if (!text || text.trim() === '') {
      return [];
    }
    
    const data = JSON.parse(text);
    
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return [];
    }
    
    // SteamSpy returns object with appids as keys
    return Object.entries(data).map(([appid, game]) => {
      const gameData = game as { 
        name?: string; 
        developer?: string; 
        publisher?: string; 
        owners?: string; 
        price?: string;
      };
      return {
        appid: appid,
        name: gameData.name || 'Unknown',
        type: 'game' as const,
        developers: gameData.developer ? [gameData.developer] : undefined,
        publishers: gameData.publisher ? [gameData.publisher] : undefined,
        owners: gameData.owners,
      };
    });
  } catch (error) {
    console.error('SteamSpy search error:', error);
    return [];
  }
}

async function searchSteamWebAPI(query: string) {
  try {
    const response = await fetch(
      `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(query)}`,
      { 
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      }
    );
    
    if (!response.ok) {
      throw new Error(`Steam Web API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      return [];
    }
    
    return data.slice(0, 20).map((item: { appid: string | number; name: string; logo: string }) => ({
      appid: String(item.appid),
      name: item.name,
      type: 'game' as const,
      header_image: item.logo,
    }));
  } catch (error) {
    console.error('Steam Web API search error:', error);
    return [];
  }
}

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

function parseSteamDBRss(xml: string): RssItem[] {
  if (!xml) return [];
  
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];
    
    const title = extractXmlTag(itemContent, 'title');
    const link = extractXmlTag(itemContent, 'link');
    const pubDate = extractXmlTag(itemContent, 'pubDate');
    const description = extractXmlTag(itemContent, 'description');
    
    if (title && link) {
      items.push({ title, link, pubDate, description });
    }
  }
  
  return items;
}

function extractXmlTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function simplifyPatchItem(item: RssItem) {
  // Extract build ID from description or title (e.g., "SteamDB Build 20441068" or "Build #12345")
  const buildMatch = `${item.description || ''} ${item.title || ''}`.match(/Build\s+[#:]?(\d{5,})/i);
  const build = buildMatch ? buildMatch[1] : null;
  
  // Extract version from title or description (e.g., "v1.2.3" or "1.2.3")
  const versionMatch = `${item.title || ''} ${item.description || ''}`.match(/(v?\d+\.\d+(?:\.\d+){0,2})/i);
  const version = versionMatch ? versionMatch[1] : null;
  
  return {
    title: item.title,
    build_id: build,
    version: version,
    link: item.link,
    pubDate: item.pubDate,
    description: item.description ? item.description.substring(0, 200) : null,
  };
}

interface SteamGameData {
  name?: string;
  type?: string;
  required_age?: number;
  is_free?: boolean;
  detailed_description?: string;
  about_the_game?: string;
  short_description?: string;
  supported_languages?: string;
  header_image?: string;
  website?: string;
  developers?: string[];
  publishers?: string[];
  price_overview?: Record<string, unknown>;
  platforms?: Record<string, unknown>;
  categories?: unknown[];
  genres?: unknown[];
  release_date?: Record<string, unknown>;
}

function pickSteamFields(data: SteamGameData) {
  return {
    name: data.name,
    type: data.type,
    required_age: data.required_age,
    is_free: data.is_free,
    detailed_description: data.detailed_description?.substring(0, 500),
    about_the_game: data.about_the_game?.substring(0, 500),
    short_description: data.short_description,
    supported_languages: data.supported_languages,
    header_image: data.header_image,
    website: data.website,
    developers: data.developers,
    publishers: data.publishers,
    price_overview: data.price_overview,
    platforms: data.platforms,
    categories: data.categories,
    genres: data.genres,
    release_date: data.release_date,
  };
}
