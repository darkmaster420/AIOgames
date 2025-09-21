import { NextResponse, NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const site = searchParams.get('site') || 'all';

    // Build external API URL and include site param when provided
    let apiUrl = 'https://gameapi.a7a8524.workers.dev/recent';
    if (site && site !== 'all') {
      apiUrl += `?site=${encodeURIComponent(site)}`;
    }

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    // Extract the results array from the API response structure
    if (data.success && data.results && Array.isArray(data.results)) {
      return NextResponse.json(data.results);
    } else {
      console.error('Invalid API response structure:', data);
      return NextResponse.json({ error: 'Invalid API response structure' }, { status: 500 });
    }
  } catch (error) {
    console.error('Get recent games error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent games' }, { status: 500 });
  }
}