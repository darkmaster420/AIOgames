import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';

// GET: Get download links for any game using the gameapi
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const postId = searchParams.get('postId');
    const siteType = searchParams.get('siteType');
    const gameTitle = searchParams.get('title');

    if (!postId || !siteType) {
      return NextResponse.json(
        { error: 'postId and siteType are required' },
        { status: 400 }
      );
    }

    try {
      // Fetch download links from the gameapi using the /post endpoint
      // postId should be the originalId (numeric WordPress post ID) from the gameapi
      const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
      const apiUrl = `${baseUrl}/post?id=${encodeURIComponent(postId)}&site=${encodeURIComponent(siteType)}`;
      
      console.log(`Fetching download links from: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'AIOGames-Tracker/1.0'
        }
      });

      if (!response.ok) {
        console.error(`GameAPI returned ${response.status}: ${response.statusText}`);
        return NextResponse.json(
          { error: `Failed to fetch download links from gameapi: ${response.status}` },
          { status: response.status }
        );
      }

      const data = await response.json();

      if (!data.success) {
        console.error('GameAPI returned error:', data.error);
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
        downloadLinks = post.downloadLinks.map((link: {
          service: string;
          url: string;
          type: string;
        }) => ({
          service: link.service,
          url: link.url,
          type: link.type,
          displayName: formatServiceName(link.service),
          icon: getServiceIcon(link.service)
        }));
      }

      const context = {
        gameTitle: gameTitle || post?.title || 'Unknown Game',
        currentVersion: 'Latest Release',
        type: 'gameapi',
        postUrl: post?.link || '',
        source: siteType
      };

      return NextResponse.json({
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
      });

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