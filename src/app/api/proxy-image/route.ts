import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return new NextResponse('Missing image URL parameter', { status: 400 });
    }

    // Validate that it's a proper URL
    let validUrl: URL;
    try {
      validUrl = new URL(imageUrl);
    } catch {
      return new NextResponse('Invalid image URL', { status: 400 });
    }

    // Security: Only allow certain domains
    const allowedDomains = [
      'gameapi.a7a8524.workers.dev',
      'via.placeholder.com',
      'cdn.cloudflare.steamstatic.com',
      'steamcdn-a.akamaihd.net',
      'shared.cloudflare.steamstatic.com',
      // Add more trusted domains as needed
    ];

    const isAllowed = allowedDomains.some(domain => 
      validUrl.hostname === domain || validUrl.hostname.endsWith('.' + domain)
    );

    if (!isAllowed) {
      return new NextResponse('Domain not allowed', { status: 403 });
    }

    // Fetch the image
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'AIOgames/1.0',
        'Accept': 'image/*',
      },
      // Add timeout
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!imageResponse.ok) {
      return new NextResponse('Failed to fetch image', { status: imageResponse.status });
    }

    // Get the image data and content type
    const imageData = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // Return the image with proper headers
    return new NextResponse(imageData, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=7200', // Cache for 1 hour, CDN cache for 2 hours
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    
    // Return a placeholder image on error
    const placeholderUrl = 'https://via.placeholder.com/300x400?text=Image+Error';
    try {
      const placeholderResponse = await fetch(placeholderUrl);
      const placeholderData = await placeholderResponse.arrayBuffer();
      
      return new NextResponse(placeholderData, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=300', // Cache error images for 5 minutes
        },
      });
    } catch {
      return new NextResponse('Image proxy error', { status: 500 });
    }
  }
}