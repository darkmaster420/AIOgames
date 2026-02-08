import { NextRequest, NextResponse } from 'next/server';
import { cleanGameTitle } from '../../../../utils/steamApi';
import { getGameApiUrl } from '../../../../utils/gameApiUrl';

interface ApiGame {
  id: string;
  title: string;
  source: string;
  siteType: string;
  [key: string]: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const site = searchParams.get('site') || 'all';

    if (!search) {
      return NextResponse.json({ error: 'Search query required' }, { status: 400 });
    }

    // Build query parameters for the external API - it supports site filtering for search
    const queryParams = new URLSearchParams({ search });
    if (site && site !== 'all') {
      queryParams.set('site', site);
    }
    
    const baseUrl = getGameApiUrl();
    const response = await fetch(`${baseUrl}?${queryParams}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GameAPI request failed (${response.status}):`, errorText);
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract the results array from the API response structure
    if (data.success && data.results && Array.isArray(data.results)) {
      // Add original titles and clean existing titles
      const results = data.results.map((game: ApiGame) => ({
        ...game,
        originalTitle: game.title, // Store the original title
        title: cleanGameTitle(game.title) // Clean the title
      }));
      
      return NextResponse.json(results);
    } else {
      console.error('Invalid search API response structure:', data);
      return NextResponse.json({ error: 'Invalid search response structure' }, { status: 500 });
    }
  } catch (error) {
    console.error('Search games error:', error);
    return NextResponse.json({ error: 'Failed to search games' }, { status: 500 });
  }
}