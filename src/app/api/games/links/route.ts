import { NextRequest, NextResponse } from 'next/server';
import { fetchPostDetailsFromBackend } from '../../../../lib/csrinBackend';
import {
  buildFollowPostDownloadResponse,
  isFollowPostSiteType,
} from '../../../../lib/downloadSitePolicy';

// In-memory cache for gameapi download link responses
const linksCache = new Map<string, { data: unknown; timestamp: number }>();
const LINKS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// GET: Get download links for any game using the gameapi
export async function GET(req: NextRequest) {
  try {

    const { searchParams } = new URL(req.url);
    const postId = searchParams.get('postId');
    const siteType = searchParams.get('siteType');
    const gameTitle = searchParams.get('title');
    const postUrlParam = searchParams.get('postUrl') || searchParams.get('link') || '';

    if (!postId || !siteType) {
      return NextResponse.json(
        { error: 'postId and siteType are required' },
        { status: 400 }
      );
    }

    if (isFollowPostSiteType(siteType)) {
      // For follow-post sites we can't synthesize a meaningful post URL
      // from postId alone (DODI is /?p=<id>, csrin is /forum/viewtopic.php
      // with f= and start=), so prefer whatever the caller already has.
      const fallbackPostUrl =
        siteType === 'csrin'
          ? `https://cs.rin.ru/forum/viewtopic.php?t=${encodeURIComponent(postId)}`
          : `https://dodi-repacks.site/?p=${encodeURIComponent(postId)}`;
      return NextResponse.json({
        postId,
        siteType,
        ...buildFollowPostDownloadResponse(
          {
            title: gameTitle || 'Unknown Game',
            gameLink: postUrlParam || fallbackPostUrl,
          },
          siteType,
        ),
      });
    }

    try {
      // Check cache first
      const cacheKey = `${siteType}:${postId}`;
      const cached = linksCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < LINKS_CACHE_TTL) {
        return NextResponse.json(cached.data);
      }

      // Fetch download links from the Python backend (post + links).
      // postId is the originalId (numeric WordPress post ID).
      console.log(`Fetching download links for: ${siteType}/${postId}`);

      const data = await fetchPostDetailsFromBackend(siteType, postId);

      if (!data.success) {
        console.error('Backend post-details returned error:', data.error);
        return NextResponse.json(
          { error: data.error || 'Failed to fetch download links' },
          { status: 500 }
        );
      }

      const post = data.post;
      let downloadLinks: Array<{
        service: string;
        url: string;
        type: string;
        displayName: string;
        icon: string;
      }> = [];

      if (post && post.downloadLinks && Array.isArray(post.downloadLinks)) {
        downloadLinks = post.downloadLinks.map((link) => {
          const service = link.service || 'direct';
          return {
            service,
            url: link.url,
            type: link.type || 'hosting',
            displayName: formatServiceName(service),
            icon: getServiceIcon(service),
          };
        });
      }

      const context = {
        gameTitle: gameTitle || post?.title || 'Unknown Game',
        currentVersion: 'Latest Release',
        type: 'gameapi',
        postUrl: post?.link || '',
        source: siteType
      };

      const responseData = {
        postId,
        siteType,
        context,
        downloadLinks,
        totalLinks: downloadLinks.length,
        post: {
          title: post?.title,
          link: post?.link,
          date: post?.date,
          description: post?.description
        }
      };

      // Cache successful responses
      if (downloadLinks.length > 0) {
        linksCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
      }

      return NextResponse.json(responseData);

    } catch (fetchError) {
      console.error('Error fetching from gameapi:', fetchError);
      return NextResponse.json(
        { error: 'Failed to connect to gameapi' },
        { status: 503 }
      );
    }

  } catch (error) {
    console.error('Error fetching download links:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper function to format service names for display
function formatServiceName(service: string): string {
  const serviceNames: { [key: string]: string } = {
    'mega': 'MEGA',
    'mediafire': 'MediaFire',
    'googledrive': 'Google Drive',
    '1fichier': '1fichier',
    'rapidgator': 'RapidGator',
    'uploadhaven': 'UploadHaven',
    'pixeldrain': 'Pixeldrain',
    'gofile': 'Gofile',
    'krakenfiles': 'KrakenFiles',
    'dailyuploads': 'DailyUploads',
    'nitroflare': 'Nitroflare',
    'turbobit': 'Turbobit',
    'hitfile': 'HitFile',
    'katfile': 'Katfile',
    'multiup': 'MultiUp',
    'torrent': 'Torrent',
    'magnet': 'Magnet Link',
    'direct': 'Direct Download'
  };
  
  return serviceNames[service.toLowerCase()] || service.charAt(0).toUpperCase() + service.slice(1);
}

// Helper function to get service icons/styles
function getServiceIcon(service: string): string {
  const serviceIcons: { [key: string]: string } = {
    'mega': '☁️',
    'mediafire': '🔥',
    'googledrive': '📁',
    '1fichier': '📄',
    'rapidgator': '⚡',
    'uploadhaven': '📤',
    'pixeldrain': '💧',
    'gofile': '📁',
    'krakenfiles': '🐙',
    'dailyuploads': '📤',
    'nitroflare': '🔥',
    'turbobit': '⚡',
    'hitfile': '🎯',
    'katfile': '🐱',
    'multiup': '📦',
    'torrent': '🌊',
    'magnet': '🧲',
    'direct': '⬇️'
  };
  
  return serviceIcons[service.toLowerCase()] || '🔗';
}