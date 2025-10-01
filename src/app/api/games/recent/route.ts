import { NextResponse, NextRequest } from 'next/server';

interface Game {
  siteType: string;
  id: string;
  title: string;
  source: string;
  [key: string]: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const site = searchParams.get('site') || 'all';

    // Always fetch all recent games from external API (no site filtering supported)
    const apiUrl = process.env.GAME_API_URL + '/recent' || 'https://gameapi.a7a8524.workers.dev/recent';
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    // Extract the results array from the API response structure
    if (data.success && data.results && Array.isArray(data.results)) {
      let results = data.results;
      
      // Apply local site filtering if a specific site is requested
      if (site && site !== 'all') {
        results = results.filter((game: Game) => game.siteType === site);
      }
      
      return NextResponse.json(results);
    } else {
      console.error('Invalid API response structure:', data);
      return NextResponse.json({ error: 'Invalid API response structure' }, { status: 500 });
    }
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}