/**
 * Game Search API - Integrated into AIOgames
 * Main entry point for game search, recent uploads, and post details
 * 
 * Endpoints:
 * - GET /?search=query&site=all - Search games across all sites or specific site
 * - GET /recent?site=all - Get recent uploads from all sites or specific site
 * - GET /post?id=123&site=skidrow - Get specific post details with download links
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  SITE_CONFIGS,
  MAX_POSTS_PER_SITE,
  fetchSteamrip,
  fetchSkidrow,
  transformPostForV2,
  type SiteConfig,
  type GamePost,
  type WordPressPost,
} from '../../../lib/gameapi/helpers';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pathname = new URL(request.url).pathname;

  try {
    // Route to appropriate handler based on query parameters
    if (searchParams.has('id') && searchParams.has('site')) {
      // Post details endpoint
      return await handlePostDetails(searchParams);
    } else if (pathname.includes('/recent') || searchParams.get('recent') === 'true') {
      // Recent uploads endpoint
      return await handleRecentUploads(searchParams);
    } else {
      // Search endpoint (default)
      return await handleSearch(searchParams);
    }
  } catch (error) {
    console.error('GameAPI Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { 
        status: 500,
        headers: corsHeaders 
      }
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Handle game search requests
 */
async function handleSearch(searchParams: URLSearchParams): Promise<NextResponse> {
  const searchQuery = searchParams.get('search');
  const siteParam = searchParams.get('site');
  const refineParam = searchParams.get('refine');

  if (!searchQuery) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing search parameter'
      },
      { status: 400, headers: corsHeaders }
    );
  }

  // If site specified, search only that site
  if (siteParam && siteParam !== 'all') {
    const siteConfig = SITE_CONFIGS[siteParam];
    if (!siteConfig) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid site parameter. Valid options: ${Object.keys(SITE_CONFIGS).join(', ')}`
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const results = await searchSite(siteConfig, searchQuery);
    const filteredResults = refineParam 
      ? results.filter(game => game.title.toLowerCase().includes(refineParam.toLowerCase()))
      : results;
    
    return NextResponse.json(
      {
        success: true,
        results: filteredResults,
        count: filteredResults.length,
        site: siteParam
      },
      { headers: corsHeaders }
    );
  }

  // Search all sites
  const allSites = Object.values(SITE_CONFIGS);
  const searchPromises = allSites.map(site => searchSite(site, searchQuery));
  const allResults = await Promise.all(searchPromises);
  let combinedResults = allResults.flat();

  // Apply refine filter if provided
  if (refineParam) {
    combinedResults = combinedResults.filter(game => 
      game.title.toLowerCase().includes(refineParam.toLowerCase())
    );
  }

  return NextResponse.json(
    {
      success: true,
      results: combinedResults,
      count: combinedResults.length
    },
    { headers: corsHeaders }
  );
}

/**
 * Search a specific site for games
 */
async function searchSite(siteConfig: SiteConfig, searchQuery: string): Promise<GamePost[]> {
  try {
    const params = new URLSearchParams({
      search: searchQuery,
      orderby: 'date',
      order: 'desc'
    });

    // GameDrive specific filter
    if (siteConfig.type === 'gamedrive') {
      params.set('categories', '3');
    }

    // Set per_page for all sites EXCEPT freegog
    if (siteConfig.type !== 'freegog') {
      const maxPosts = MAX_POSTS_PER_SITE[siteConfig.type] || MAX_POSTS_PER_SITE.default;
      params.set('per_page', maxPosts.toString());
    }

    const url = `${siteConfig.baseUrl}?${params}`;
    
    let response;
    if (siteConfig.type === 'steamrip') {
      response = await fetchSteamrip(url);
    } else if (siteConfig.type === 'skidrow') {
      response = await fetchSkidrow(url);
    } else {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'GameSearch-API-v2/2.0'
        }
      });
    }

    if (!response || !response.ok) {
      console.error(`${siteConfig.name} returned ${response?.status || 'no response'}`);
      return [];
    }

    const posts = await response.json();
    const transformPromises = posts.map((post: unknown) => transformPostForV2(post as WordPressPost, siteConfig, false));
    return await Promise.all(transformPromises);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error searching ${siteConfig.name}:`, errorMessage);
    
    // Check if it's a FlareSolverr missing error
    if (errorMessage.includes('FLARESOLVERR_URL')) {
      console.warn(`Skipping ${siteConfig.name} - FlareSolverr not configured`);
    }
    
    return [];
  }
}

/**
 * Handle recent uploads request
 */
async function handleRecentUploads(searchParams: URLSearchParams): Promise<NextResponse> {
  const siteParam = searchParams.get('site');

  // If site specified, get recent from that site only
  if (siteParam && siteParam !== 'all') {
    const siteConfig = SITE_CONFIGS[siteParam];
    if (!siteConfig) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid site parameter. Valid options: ${Object.keys(SITE_CONFIGS).join(', ')}`
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const results = await fetchRecentFromSite(siteConfig);
    return NextResponse.json(
      {
        success: true,
        results,
        count: results.length,
        site: siteParam,
        cached: false
      },
      { headers: corsHeaders }
    );
  }

  // Fetch recent from all sites
  const allSites = Object.values(SITE_CONFIGS);
  const fetchPromises = allSites.map(site => fetchRecentFromSite(site));
  const allResults = await Promise.all(fetchPromises);
  const combinedResults = allResults.flat();

  // Sort by date (newest first)
  combinedResults.sort((a, b) => {
    const dateA = new Date((a as { date?: string }).date || 0).getTime();
    const dateB = new Date((b as { date?: string }).date || 0).getTime();
    return dateB - dateA;
  });

  return NextResponse.json(
    {
      success: true,
      results: combinedResults,
      count: combinedResults.length,
      cached: false
    },
    { headers: corsHeaders }
  );
}

/**
 * Fetch recent posts from a specific site
 */
async function fetchRecentFromSite(siteConfig: SiteConfig): Promise<GamePost[]> {
  try {
    const params = new URLSearchParams({
      orderby: 'date',
      order: 'desc'
    });

    if (siteConfig.type === 'gamedrive') {
      params.set('categories', '3');
    }

    if (siteConfig.type !== 'freegog') {
      const maxPosts = MAX_POSTS_PER_SITE[siteConfig.type] || MAX_POSTS_PER_SITE.default;
      params.set('per_page', maxPosts.toString());
      params.set('page', '1');
    }

    const url = `${siteConfig.baseUrl}?${params}`;
    
    let response;
    if (siteConfig.type === 'steamrip') {
      response = await fetchSteamrip(url);
    } else if (siteConfig.type === 'skidrow') {
      response = await fetchSkidrow(url);
    } else {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'GameSearch-API-v2/2.0'
        }
      });
    }

    if (!response || !response.ok) {
      return [];
    }

    const posts = await response.json();
    const transformPromises = posts.map((post: unknown) => transformPostForV2(post as WordPressPost, siteConfig, false));
    return await Promise.all(transformPromises);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error fetching recent from ${siteConfig.name}:`, errorMessage);
    
    // Check if it's a FlareSolverr missing error
    if (errorMessage.includes('FLARESOLVERR_URL')) {
      console.warn(`Skipping ${siteConfig.name} - FlareSolverr not configured`);
    }
    
    return [];
  }
}

/**
 * Handle post details request
 */
async function handlePostDetails(searchParams: URLSearchParams): Promise<NextResponse> {
  const postId = searchParams.get('id');
  const site = searchParams.get('site');

  if (!postId) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing post ID parameter'
      },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!site) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing site parameter (skidrow, freegog, gamedrive, steamrip)'
      },
      { status: 400, headers: corsHeaders }
    );
  }

  const siteConfig = SITE_CONFIGS[site];
  if (!siteConfig) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid site parameter. Valid options: ${Object.keys(SITE_CONFIGS).join(', ')}`
      },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    let postUrl;
    let response;
    
    // WordPress REST API format: /wp-json/wp/v2/posts/{id}
    if (siteConfig.type === 'steamrip') {
      postUrl = `${siteConfig.baseUrl}/${postId}`;
      response = await fetchSteamrip(postUrl);
    } else if (siteConfig.type === 'skidrow') {
      postUrl = `${siteConfig.baseUrl}/${postId}`;
      response = await fetchSkidrow(postUrl);
    } else {
      postUrl = `${siteConfig.baseUrl}/${postId}`;
      response = await fetch(postUrl, {
        headers: {
          'User-Agent': 'Game-Search-API-v2/2.0'
        }
      });
    }

    if (!response || !response.ok) {
      throw new Error(`${siteConfig.name} API returned ${response?.status || 'no response'}: ${response?.statusText || 'unknown error'}`);
    }

    const post = await response.json();
    const transformedPost = await transformPostForV2(post, siteConfig, true);

    return NextResponse.json(
      {
        success: true,
        post: transformedPost,
        cached: false
      },
      { headers: corsHeaders }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching post details:', errorMessage);
    
    // Provide helpful error message for FlareSolverr requirement
    let userError = errorMessage;
    if (errorMessage.includes('FLARESOLVERR_URL')) {
      userError = `This site requires FlareSolverr to bypass Cloudflare protection. Please configure FLARESOLVERR_URL in your environment variables. ${errorMessage}`;
    }
    
    return NextResponse.json(
      {
        success: false,
        error: userError
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
