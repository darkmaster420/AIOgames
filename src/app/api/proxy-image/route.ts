import { NextRequest, NextResponse } from 'next/server';
import {
  getValidSteamripCookie,
  getValidSkidrowCookie,
  getValidDodiCookie,
  getFreshSteamripCookie,
  getFreshSkidrowCookie,
  getFreshDodiCookie,
} from '../../../lib/gameapi/helpers.js';

// Cookie jar shape returned by the helpers above
interface CookieJar {
  cf_clearance: string | null;
  cookies: string[];
  userAgent: string | null;
  expires_at: number;
}

type SiteKey = 'steamrip' | 'skidrow' | 'dodi';

// Map image hostnames to the site-specific cookie jar getters.
// These hostnames include the main site domains and any known CDN/image
// subdomains that Cloudflare-protects. Match is substring-based so we cover
// `www.`, `i0.wp.com`-style CDNs, etc.
const HOST_MATCHERS: Array<{
  match: (host: string) => boolean;
  key: SiteKey;
  getValid: () => Promise<CookieJar>;
  getFresh: () => Promise<CookieJar>;
}> = [
  {
    match: h => h.includes('steamrip.com'),
    key: 'steamrip',
    getValid: getValidSteamripCookie as () => Promise<CookieJar>,
    getFresh: getFreshSteamripCookie as () => Promise<CookieJar>,
  },
  {
    match: h => h.includes('skidrowreloaded.com'),
    key: 'skidrow',
    getValid: getValidSkidrowCookie as () => Promise<CookieJar>,
    getFresh: getFreshSkidrowCookie as () => Promise<CookieJar>,
  },
  {
    match: h => h.includes('dodi-repacks.download') || h.includes('dodi-repacks.site') || h.includes('dodi-repacks.com'),
    key: 'dodi',
    getValid: getValidDodiCookie as () => Promise<CookieJar>,
    getFresh: getFreshDodiCookie as () => Promise<CookieJar>,
  },
];

function buildHeaders(jar: CookieJar | null, referer: string): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent':
      jar?.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
  };
  if (jar?.cookies?.length) {
    headers['Cookie'] = jar.cookies.join('; ');
  }
  return headers;
}

// A response is a Cloudflare challenge (not the real image) if the status is
// 403/503 or the content-type is HTML instead of an image.
function looksLikeChallenge(res: Response): boolean {
  if (res.status === 403 || res.status === 503) return true;
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('text/html')) return true;
  return false;
}

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

    const host = validUrl.hostname.toLowerCase();
    const matcher = HOST_MATCHERS.find(m => m.match(host));

    // For CF-protected hosts, attach the cached FlareSolverr-issued cf_clearance
    // cookie + matching User-Agent so Cloudflare lets the image request through.
    // We retry once with a fresh cookie if the first attempt smells like a CF
    // challenge, and finally give up — the caller can fall back to IGDB/RAWG.
    let imageResponse: Response | null = null;
    let usedCookieJar = false;

    if (matcher) {
      usedCookieJar = true;
      try {
        let jar: CookieJar | null = null;
        try {
          jar = await matcher.getValid();
        } catch (err) {
          console.warn(`[proxy-image] Failed to get ${matcher.key} cookie:`, err);
        }

        if (jar) {
          imageResponse = await fetch(imageUrl, {
            headers: buildHeaders(jar, validUrl.origin),
            signal: AbortSignal.timeout(15000),
          });

          if (looksLikeChallenge(imageResponse)) {
            console.warn(
              `[proxy-image] ${matcher.key} cookie didn't work for ${host} (status ${imageResponse.status}, ct=${imageResponse.headers.get('content-type')}). Refreshing and retrying once...`
            );
            try {
              const fresh = await matcher.getFresh();
              imageResponse = await fetch(imageUrl, {
                headers: buildHeaders(fresh, validUrl.origin),
                signal: AbortSignal.timeout(15000),
              });
            } catch (err) {
              console.warn(`[proxy-image] Failed to refresh ${matcher.key} cookie:`, err);
            }
          }
        }
      } catch (err) {
        console.warn(`[proxy-image] Cookie-based fetch failed for ${host}:`, err);
      }
    }

    // Non-CF host, or cookie-based fetch was skipped/failed to produce a usable
    // response — do a plain fetch. Browsers/IGDB/RAWG/Steam CDN URLs fall here.
    if (!imageResponse || looksLikeChallenge(imageResponse)) {
      imageResponse = await fetch(imageUrl, {
        headers: buildHeaders(null, validUrl.origin),
        signal: AbortSignal.timeout(15000),
      });
    }

    if (!imageResponse.ok || looksLikeChallenge(imageResponse)) {
      console.log(
        `[proxy-image] Failed to fetch ${host}: status=${imageResponse.status} ct=${imageResponse.headers.get('content-type')} cookieUsed=${usedCookieJar}`
      );
      return new NextResponse('Failed to fetch image', { status: imageResponse.status || 502 });
    }

    const imageData = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    return new NextResponse(imageData, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=7200',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Image proxy error:', error);

    const placeholderUrl = 'https://via.placeholder.com/300x400?text=Image+Error';
    try {
      const placeholderResponse = await fetch(placeholderUrl);
      const placeholderData = await placeholderResponse.arrayBuffer();

      return new NextResponse(placeholderData, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch {
      return new NextResponse('Image proxy error', { status: 500 });
    }
  }
}
