import { NextRequest, NextResponse } from 'next/server';
import { getOrFetchImage } from '../../../utils/imageCache';

// All the heavy lifting (Cloudflare cookie handling, retry-on-challenge,
// in-memory byte cache) lives in `utils/imageCache.ts` so it can be shared
// between this route and the background enrichment pass that warms the cache
// right after a scrape. By the time the browser asks for an image, it's
// usually already a memory hit here.

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return new NextResponse('Missing image URL parameter', { status: 400 });
    }

    let validUrl: URL;
    try {
      validUrl = new URL(imageUrl);
    } catch {
      return new NextResponse('Invalid image URL', { status: 400 });
    }

    if (validUrl.protocol !== 'https:') {
      return new NextResponse('Only HTTPS URLs are allowed', { status: 403 });
    }

    const blockedDomains = ['localhost', '127.0.0.1', '0.0.0.0', '10.', '172.', '192.168.'];
    const isBlocked = blockedDomains.some(
      blocked => validUrl.hostname.startsWith(blocked) || validUrl.hostname.includes(blocked)
    );
    if (isBlocked) {
      return new NextResponse('Domain not allowed for security reasons', { status: 403 });
    }

    const cached = await getOrFetchImage(imageUrl);

    if (!cached) {
      return new NextResponse('Failed to fetch image', { status: 502 });
    }

    const cacheAgeSec = Math.floor((Date.now() - cached.timestamp) / 1000);

    return new NextResponse(cached.buffer, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        // Long browser cache — images at a given URL don't change. Combined
        // with the server-side byte cache this means a user loading the home
        // page hits the browser cache or this server's memory cache; we
        // almost never go back to the origin site.
        'Cache-Control': 'public, max-age=21600, s-maxage=86400, immutable',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Image-Cache': cacheAgeSec < 2 ? 'MISS' : 'HIT',
        'X-Image-Cache-Age': cacheAgeSec.toString(),
      },
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Image proxy error', { status: 500 });
  }
}
