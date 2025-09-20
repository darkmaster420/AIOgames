import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('https://gameapi.a7a8524.workers.dev/recent');
    
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