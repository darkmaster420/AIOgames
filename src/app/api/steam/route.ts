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

      let results;
      
      // If query is numeric, treat as appid
      if (/^\d+$/.test(q)) {
        const data = await fetchSteamSpyAppDetails(q);
        results = { source: 'steamspy', q, type: 'appid', results: data };
      } else {
        // Text search
        const searchResults = await searchSteamSpyByName(q);
        
        // Fallback to Steam Web API if SteamSpy results are poor
        const shouldTryFallback = 
          searchResults.length === 1 && searchResults[0].appid === null ||
          searchResults.length === 0 ||
          (searchResults.length < 3 && !searchResults.some(r => 
            r.name && r.name.toLowerCase().includes(q.toLowerCase())
          ));
        
        if (shouldTryFallback) {
          try {
            const steamResults = await searchSteamWebAPI(q);
            if (steamResults.length > 0) {
              results = { source: 'steam_web_api', q, type: 'search', results: steamResults };
            } else {
              results = { source: 'steamspy', q, type: 'search', results: searchResults };
            }
          } catch {
            results = { source: 'steamspy', q, type: 'search', results: searchResults };
          }
        } else {
          results = { source: 'steamspy', q, type: 'search', results: searchResults };
        }
      }
      
      return NextResponse.json(results, { headers: CORS_HEADERS });
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
  const response = await fetch(
    `https://steamspy.com/api.php?request=search&query=${encodeURIComponent(query)}`,
    { next: { revalidate: 3600 } }
  );
  const data = await response.json();
  
  if (!data || typeof data !== 'object') {
    return [{ appid: null, name: 'No results found' }];
  }
  
  return Object.entries(data).map(([appid, game]) => {
    const gameData = game as { name?: string; developer?: string; publisher?: string; owners?: string; price?: string };
    return {
      appid: parseInt(appid),
      name: gameData.name,
      developer: gameData.developer,
      publisher: gameData.publisher,
      owners: gameData.owners,
      price: gameData.price,
    };
  });
}

async function searchSteamWebAPI(query: string) {
  const response = await fetch(
    `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(query)}`,
    { next: { revalidate: 3600 } }
  );
  const data = await response.json();
  
  if (!Array.isArray(data)) {
    return [];
  }
  
  return data.map((item: { appid: string | number; name: string; logo: string }) => ({
    appid: parseInt(String(item.appid)),
    name: item.name,
    logo: item.logo,
  }));
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
