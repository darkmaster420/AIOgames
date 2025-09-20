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

    // Security: Only require HTTPS protocol, be more permissive with domains for VPS
    if (validUrl.protocol !== 'https:') {
      return new NextResponse('Only HTTPS URLs are allowed', { status: 403 });
    }

    // More permissive domain checking - block only obviously bad domains
    const blockedDomains = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '10.',
      '172.',
      '192.168.',
    ];

    const isBlocked = blockedDomains.some(blocked => 
      validUrl.hostname.startsWith(blocked) || validUrl.hostname.includes(blocked)
    );

    if (isBlocked) {
      console.log('Domain blocked for security:', validUrl.hostname);
      return new NextResponse('Domain not allowed for security reasons', { status: 403 });
    }

    // Fetch the image with better headers for CORS
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': validUrl.origin,
      },
      // Add timeout
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!imageResponse.ok) {
      console.log(`Failed to fetch image from ${validUrl.hostname}: ${imageResponse.status} ${imageResponse.statusText}`);
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