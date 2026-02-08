/**
 * Game Search API v2 - Core Library
 * Shared logic for game search, recent uploads, and post details
 */

// Types
export interface CookieStorage {
  cf_clearance: string | null;
  cookies: string[];
  userAgent: string | null;
  expires_at: number;
}

export interface SiteConfig {
  baseUrl: string;
  type: string;
  name: string;
}

export interface SiteConfigs {
  [key: string]: SiteConfig;
}

export interface GamePost {
  id: string;
  title: string;
  source: string;
  siteType: string;
  [key: string]: unknown;
}

export interface WordPressPost {
  id: number | string;
  link: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  date?: string;
  slug?: string;
  categories?: unknown[];
  tags?: unknown[];
  featured_image_src?: string;
  jetpack_featured_media_url?: string;
  yoast_head_json?: {
    og_image?: Array<{ url: string }>;
  };
}

// Cache configuration
export const CACHE_CONFIG = {
  CACHE_TTL: 3600, // 1 hour
  STALE_WHILE_REVALIDATE: 7200, // 2 hours
  CACHE_PREFIX: 'game-search-v2:',
  RECENT_UPLOADS_KEY: 'recent-uploads-complete',
};

// FlareSolverr timeout/retry settings (ms)
export const DEFAULT_FLARE_TIMEOUT_MS = 30000; // 30s default
export const DEFAULT_FLARE_RETRIES = 2;

// Cookie storage for SteamRip and Skidrow (in-memory for this instance)
let steamripCookie: CookieStorage = {
  cf_clearance: null,
  cookies: [], // Store all cookies from FlareSolverr
  userAgent: null, // Store the User-Agent used by FlareSolverr
  expires_at: 0
};

let skidrowCookie: CookieStorage = {
  cf_clearance: null,
  cookies: [],
  userAgent: null,
  expires_at: 0
};

// Timeout and retry helpers
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(resource: string, options: RequestInit = {}, timeoutMs: number = DEFAULT_FLARE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  options.signal = controller.signal;
  try {
    const res = await fetch(resource, options);
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export async function retryableFetch(resource: string, options: RequestInit = {}, attempts: number = DEFAULT_FLARE_RETRIES, timeoutMs: number = DEFAULT_FLARE_TIMEOUT_MS): Promise<Response> {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithTimeout(resource, options, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

// Maximum posts to fetch per site
export const MAX_POSTS_PER_SITE: Record<string, number> = {
  'skidrow': 40,
  'gamedrive': 40,
  'steamrip': 40,
  'freegog': 40,
  'default': 50
};

// Site configurations
export const SITE_CONFIGS: SiteConfigs = {
  'skidrow': {
    baseUrl: 'https://www.skidrowreloaded.com/wp-json/wp/v2/posts',
    type: 'skidrow',
    name: 'SkidrowReloaded'
  },
  'freegog': {
    baseUrl: 'https://freegogpcgames.com/wp-json/wp/v2/posts',
    type: 'freegog',
    name: 'FreeGOGPCGames'
  },
  'gamedrive': {
    baseUrl: 'https://gamedrive.org/wp-json/wp/v2/posts',
    type: 'gamedrive',
    name: 'GameDrive'
  },
  'steamrip': {
    baseUrl: 'https://steamrip.com/wp-json/wp/v2/posts',
    type: 'steamrip',
    name: 'SteamRip'
  }
};

// Helper functions
export function stripHtml(html: string | { rendered?: string } | unknown): string {
  // Handle cases where html might be an object with a 'rendered' property
  if (typeof html === 'object' && html !== null && 'rendered' in html) {
    html = (html as { rendered?: string }).rendered || '';
  }
  // Ensure we have a string
  if (typeof html !== 'string') {
    return '';
  }
  return html.replace(/<[^>]*>?/gm, '');
}

export function getSiteConfig(siteType: string): SiteConfig | null {
  return SITE_CONFIGS[siteType] || null;
}

export function extractServiceName(url: string): string {
  try {
    let testUrl = url;
    if (url.startsWith('//')) {
      testUrl = 'https:' + url;
    }

    const parsed = new URL(testUrl);
    const host = parsed.hostname.toLowerCase();
    
    if (host.includes('gamedrive.org')) return 'GameDrive';
    if (host.includes('torrent.cybar.xyz')) return 'CybarTorrent';
    if (host.includes('freegogpcgames.com') || host.includes('gdl.freegogpcgames.xyz')) {
      return 'FreeGOG';
    }
    if (host.includes('mediafire')) return 'Mediafire';
    if (host.includes('megadb')) return 'MegaDB';
    if (host.includes('mega')) return 'MEGA';
    if (host.includes('1fichier')) return '1Fichier';
    if (host.includes('rapidgator')) return 'Rapidgator';
    if (host.includes('uploaded')) return 'Uploaded';
    if (host.includes('turbobit')) return 'Turbobit';
    if (host.includes('nitroflare')) return 'Nitroflare';
    if (host.includes('katfile')) return 'Katfile';
    if (host.includes('pixeldrain')) return 'Pixeldrain';
    if (host.includes('gofile')) return 'Gofile';
    if (host.includes('mixdrop')) return 'Mixdrop';
    if (host.includes('krakenfiles')) return 'KrakenFiles';
    if (host.includes('filefactory')) return 'FileFactory';
    if (host.includes('dailyuploads')) return 'DailyUploads';
    if (host.includes('multiup')) return 'MultiUp';
    if (host.includes('zippyshare')) return 'Zippyshare';
    if (host.includes('drive.google')) return 'Google Drive';
    if (host.includes('dropbox')) return 'Dropbox';
    if (host.includes('onedrive')) return 'OneDrive';
    if (host.includes('torrent')) return 'Torrent';
    if (host.includes('buzzheavier')) return 'BuzzHeavier';
    if (host.includes('datanodes')) return 'DataNodes';
    if (host.includes('filecrypt')) return 'FileCrypt';
    if (host.includes('hitfile')) return 'HitFile';
    if (host.includes('ufile')) return 'UFile';
    if (host.includes('clicknupload')) return 'ClicknUpload';
    
    return host;
  } catch {
    if (url.includes('megadb')) return 'MegaDB';
    if (url.includes('buzzheavier')) return 'BuzzHeavier';
    if (url.includes('datanodes')) return 'DataNodes';
    if (url.includes('filecrypt')) return 'FileCrypt';
    if (url.includes('hitfile')) return 'HitFile';
    if (url.includes('ufile')) return 'UFile';
    if (url.includes('clicknupload')) return 'ClicknUpload';
    return 'Unknown';
  }
}

export function classifyTorrentLink(url: string, linkText = ''): { type: string; service: string; url: string; isTorrent: boolean; } | null {
  const cleanText = stripHtml(linkText).trim();
  
  if (url.startsWith('magnet:')) {
    return {
      type: 'magnet',
      service: 'Magnet Link',
      url: url,
      isTorrent: true
    };
  }
  
  if (url.toLowerCase().endsWith('.torrent') || url.includes('/torrent/') || url.includes('torrent.')) {
    return {
      type: 'torrent-file',
      service: extractServiceName(url),
      url: url,
      isTorrent: true
    };
  }
  
  
  return null;
}

// FlareSolverr cookie management for SteamRip
export async function getFreshSteamripCookie(): Promise<CookieStorage> {
  console.log('Getting fresh cf_clearance cookie for SteamRip');

  try {
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (!flaresolverrUrl) {
      throw new Error('FLARESOLVERR_URL environment variable is required for SteamRip. Please set it to your FlareSolverr instance URL (e.g., http://localhost:8191/v1)');
    }
    
    const attempts = parseInt(process.env.FLARE_RETRIES || String(DEFAULT_FLARE_RETRIES), 10) || DEFAULT_FLARE_RETRIES;
    const timeoutMs = parseInt(process.env.FLARE_TIMEOUT_MS || String(DEFAULT_FLARE_TIMEOUT_MS), 10) || DEFAULT_FLARE_TIMEOUT_MS;

    const response = await retryableFetch(flaresolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cmd: 'request.get',
        url: 'https://steamrip.com/wp-json/wp/v2/posts',
        userAgent: 'GameSearch-API-v2/2.0'
      })
    }, attempts, timeoutMs);

    if (!response.ok) {
      throw new Error(`FlareSolverr request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'ok') {
      throw new Error(`FlareSolverr error: ${data.message}`);
    }

    // Extract cf_clearance cookie and all cookies
    let cf_clearance: string | null = null;
    let expires_at = Date.now() + (4 * 60 * 60 * 1000); // Default 4 hours from now
    const allCookies: string[] = [];

    if (data.solution.cookies && Array.isArray(data.solution.cookies)) {
      // Store all cookies
      data.solution.cookies.forEach((cookie: { name: string; value: string; expires?: number }) => {
        allCookies.push(`${cookie.name}=${cookie.value}`);
        if (cookie.name === 'cf_clearance') {
          cf_clearance = cookie.value;
          if (cookie.expires) {
            expires_at = new Date(cookie.expires * 1000).getTime();
          }
        }
      });

      if (cf_clearance) {
        console.log('Successfully obtained cf_clearance cookie:', (cf_clearance as string).substring(0, 20) + '...');
        console.log(`Total cookies from FlareSolverr: ${allCookies.length}`);
      }
    }

    if (!cf_clearance) {
      throw new Error('Failed to extract cf_clearance cookie from FlareSolverr response');
    }

    // Store the User-Agent that FlareSolverr used
    const userAgent = data.solution.userAgent || 'GameSearch-API-v2/2.0';

    steamripCookie = {
      cf_clearance: cf_clearance,
      cookies: allCookies,
      userAgent: userAgent,
      expires_at: expires_at
    };

    return steamripCookie;
  } catch (error) {
    console.error('Error getting fresh SteamRip cookie:', error);
    throw error;
  }
}

export async function getValidSteamripCookie(): Promise<CookieStorage> {
  if (!steamripCookie.cf_clearance || Date.now() >= steamripCookie.expires_at) {
    return await getFreshSteamripCookie();
  }
  return steamripCookie;
}

export async function fetchSteamrip(url: string, isPageRequest = false): Promise<Response | null> {
  try {
    // First, try to get a valid cookie from FlareSolverr
    const cookie = await getValidSteamripCookie();
    
    // Use the same User-Agent that FlareSolverr used to get the cookie
    const userAgent = cookie.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    // Use all cookies, not just cf_clearance
    const cookieString = cookie.cookies.join('; ');

    console.log(`Fetching SteamRip with cookies: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Cookie': cookieString,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://steamrip.com/',
        'Origin': 'https://steamrip.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      }
    });

    // Check for Cloudflare protection even with 200 status
    let stillBlocked = hasCloudflareProtection(response);
    
    if (!stillBlocked && response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const text = await response.text();
      stillBlocked = hasCloudflareProtection(response, text);
      
      if (!stillBlocked) {
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    } else if (!stillBlocked && response.ok) {
      return response;
    }

    // Cookie didn't work or still blocked, get fresh cookie
    if (stillBlocked || response.status === 403) {
      console.log('Cookie did not bypass Cloudflare or received 403, getting fresh cookie for SteamRip');
      const freshCookie = await getFreshSteamripCookie();
      const freshUserAgent = freshCookie.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      const freshCookieString = freshCookie.cookies.join('; ');

      const retryResponse = await fetch(url, {
        headers: {
          'User-Agent': freshUserAgent,
          'Cookie': freshCookieString,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://steamrip.com/',
          'Origin': 'https://steamrip.com',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin'
        }
      });

      if (!retryResponse.ok) {
        if (isPageRequest) {
          console.warn(`Failed to fetch SteamRip page: ${retryResponse.status} ${retryResponse.statusText} (even with fresh cookie)`);
          return null;
        } else {
          throw new Error(`SteamRip API returned ${retryResponse.status}: ${retryResponse.statusText} (even with fresh cookie)`);
        }
      }

      return retryResponse;
    }

    if (!response.ok) {
      if (isPageRequest) {
        console.warn(`Failed to fetch SteamRip page: ${response.status} ${response.statusText}`);
        return null;
      } else {
        throw new Error(`SteamRip API returned ${response.status}: ${response.statusText}`);
      }
    }

    return response;
  } catch (error) {
    console.error(`Error fetching SteamRip:`, error);
    if (isPageRequest) {
      return null;
    } else {
      throw error;
    }
  }
}

// FlareSolverr cookie management for SkidrowReloaded
export async function getFreshSkidrowCookie(): Promise<CookieStorage> {
  console.log('Getting fresh cf_clearance cookie for SkidrowReloaded');

  try {
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (!flaresolverrUrl) {
      throw new Error('FLARESOLVERR_URL environment variable is required for SkidrowReloaded. Please set it to your FlareSolverr instance URL (e.g., http://localhost:8191/v1)');
    }
    
    const attempts = parseInt(process.env.FLARE_RETRIES || String(DEFAULT_FLARE_RETRIES), 10) || DEFAULT_FLARE_RETRIES;
    const timeoutMs = parseInt(process.env.FLARE_TIMEOUT_MS || String(DEFAULT_FLARE_TIMEOUT_MS), 10) || DEFAULT_FLARE_TIMEOUT_MS;

    const response = await retryableFetch(flaresolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cmd: 'request.get',
        url: 'https://www.skidrowreloaded.com/',
        userAgent: 'GameSearch-API-v2/2.0'
      })
    }, attempts, timeoutMs);

    if (!response.ok) {
      throw new Error(`FlareSolverr request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'ok') {
      throw new Error(`FlareSolverr error: ${data.message}`);
    }

    console.log(`FlareSolverr response for Skidrow: status=${data.status}, cookies=${data.solution?.cookies?.length || 0}`);

    let cf_clearance: string | null = null;
    let expires_at = Date.now() + (4 * 60 * 60 * 1000);
    const allCookies: string[] = [];

    if (data.solution.cookies && Array.isArray(data.solution.cookies)) {
      data.solution.cookies.forEach((cookie: { name: string; value: string; expires?: number }) => {
        allCookies.push(`${cookie.name}=${cookie.value}`);
        if (cookie.name === 'cf_clearance') {
          cf_clearance = cookie.value;
          if (cookie.expires) {
            expires_at = new Date(cookie.expires * 1000).getTime();
          }
        }
      });

      console.log(`Cookies received: ${data.solution.cookies.map((c: { name: string }) => c.name).join(', ')}`);
      
      if (cf_clearance) {
        console.log('Successfully obtained cf_clearance cookie for SkidrowReloaded:', (cf_clearance as string).substring(0, 20) + '...');
        console.log(`Total cookies from FlareSolverr: ${allCookies.length}`);
      }
    }

    // If no cf_clearance but we have other cookies, use them anyway
    if (!cf_clearance && allCookies.length > 0) {
      console.log('No cf_clearance cookie found, but using other cookies from FlareSolverr');
    } else if (!cf_clearance && allCookies.length === 0) {
      console.log('No cookies returned from FlareSolverr - Cloudflare protection is likely not active');
      // Set empty cookie but mark as valid since CF is not protecting
      cf_clearance = 'none';
    } else if (!cf_clearance) {
      throw new Error('Failed to extract cf_clearance cookie from FlareSolverr response for SkidrowReloaded');
    }

    const userAgent = data.solution.userAgent || 'GameSearch-API-v2/2.0';

    skidrowCookie = {
      cf_clearance: cf_clearance,
      cookies: allCookies,
      userAgent: userAgent,
      expires_at: expires_at
    };

    return skidrowCookie;
  } catch (error) {
    console.error('Error getting fresh SkidrowReloaded cookie:', error);
    throw error;
  }
}

export async function getValidSkidrowCookie(): Promise<CookieStorage> {
  if (!skidrowCookie.cf_clearance || Date.now() >= skidrowCookie.expires_at) {
    return await getFreshSkidrowCookie();
  }
  return skidrowCookie;
}

// Helper function to detect Cloudflare protection in response
function hasCloudflareProtection(response: Response, htmlContent: string | null = null): boolean {
  // Check HTTP status codes
  const cloudflareStatus = [403, 503];
  if (cloudflareStatus.includes(response.status)) {
    return true;
  }

  // Check HTML content for Cloudflare patterns (if provided or if content-type is HTML)
  if (response.headers.get('content-type')?.includes('text/html')) {
    if (htmlContent) {
      // Check provided HTML content
      if (htmlContent.includes('cf-browser-verification') || 
          htmlContent.includes('Cloudflare') || 
          htmlContent.includes('Attention Required') ||
          htmlContent.includes('cf-challenge') ||
          htmlContent.includes('Just a moment...') ||
          htmlContent.includes('Enable JavaScript and cookies')) {
        return true;
      }
    }
  }

  // Check for Cloudflare headers
  if (response.headers.get('cf-ray') || response.headers.get('cf-cache-status')) {
    // Has Cloudflare headers but need to check if it's actually blocking
    // If we have 200 status but CF headers, we need to check the content
    return false; // Will be checked with content later
  }

  return false;
}

export async function fetchSkidrow(url: string, isPageRequest = false): Promise<Response | null> {
  try {
    const userAgent = isPageRequest ? 'GameSearch-API-v2-PageFetch/2.0' : 'GameSearch-API-v2/2.0';

    // Try direct fetch first
    let response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    // Check for Cloudflare protection - even if status is 200!
    let isCloudflare = hasCloudflareProtection(response);
    console.log(`Initial fetch of ${url}: status=${response.status}, CF detected=${isCloudflare}`);

    // If response looks OK but is HTML, check the content for CF protection
    if (!isCloudflare && response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const text = await response.text();
      isCloudflare = hasCloudflareProtection(response, text);
      
      if (!isCloudflare) {
        // No CF protection detected, return the response
        // But we already consumed the body, so create a new response with the text
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    } else if (!isCloudflare && response.ok) {
      // Not HTML and no CF detected, return as-is
      return response;
    }

    // Cloudflare protection detected, try with cookie
    if (isCloudflare) {
      console.log('Cloudflare protection detected on Skidrow, using FlareSolverr cookie');
      const cookie = await getValidSkidrowCookie();
      
      // If FlareSolverr returned no cookies, CF is likely not active - try direct fetch
      if (cookie.cf_clearance === 'none' && cookie.cookies.length === 0) {
        console.log('FlareSolverr returned no cookies (CF not active), trying direct fetch');
        response = await fetch(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });
        
        if (response.ok) {
          return response;
        } else {
          if (isPageRequest) {
            console.warn(`Failed to fetch SkidrowReloaded page: ${response.status} ${response.statusText}`);
            return null;
          } else {
            throw new Error(`SkidrowReloaded API returned ${response.status}: ${response.statusText}`);
          }
        }
      }
      
      const cookieUserAgent = cookie.userAgent || userAgent;
      const cookieString = cookie.cookies.join('; ');
      
      response = await fetch(url, {
        headers: {
          'User-Agent': cookieUserAgent,
          'Cookie': cookieString,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.skidrowreloaded.com/',
          'Origin': 'https://www.skidrowreloaded.com'
        }
      });

      // Check if the response with cookie still has CF protection
      let stillBlocked = hasCloudflareProtection(response);
      console.log(`After cookie fetch: status=${response.status}, stillBlocked=${stillBlocked}, cookies used=${cookie.cookies.length}`);
      
      if (!stillBlocked && response.ok && response.headers.get('content-type')?.includes('text/html')) {
        const text = await response.text();
        stillBlocked = hasCloudflareProtection(response, text);
        
        if (!stillBlocked) {
          return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      } else if (!stillBlocked && response.ok) {
        return response;
      }

      // Cookie didn't work or still blocked, get fresh cookie
      if (stillBlocked || response.status === 403) {
        console.log('Cookie did not bypass Cloudflare or received 403, getting fresh cookie');
        const freshCookie = await getFreshSkidrowCookie();
        const freshUserAgent = freshCookie.userAgent || userAgent;
        const freshCookieString = freshCookie.cookies.join('; ');
        
        const retryResponse = await fetch(url, {
          headers: {
            'User-Agent': freshUserAgent,
            'Cookie': freshCookieString,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.skidrowreloaded.com/',
            'Origin': 'https://www.skidrowreloaded.com'
          }
        });

        if (!retryResponse.ok) {
          if (isPageRequest) {
            console.warn(`Failed to fetch SkidrowReloaded page: ${retryResponse.status} ${retryResponse.statusText} (even with fresh cookie)`);
            return null;
          } else {
            throw new Error(`SkidrowReloaded API returned ${retryResponse.status}: ${retryResponse.statusText} (even with fresh cookie)`);
          }
        }
        return retryResponse;
      }

      if (!response.ok) {
        if (isPageRequest) {
          console.warn(`Failed to fetch SkidrowReloaded page: ${response.status} ${response.statusText}`);
          return null;
        } else {
          throw new Error(`SkidrowReloaded API returned ${response.status}: ${response.statusText}`);
        }
      }
      return response;
    } else {
      if (isPageRequest) {
        console.warn(`Failed to fetch SkidrowReloaded page: ${response.status} ${response.statusText}`);
        return null;
      } else {
        throw new Error(`SkidrowReloaded API returned ${response.status}: ${response.statusText}`);
      }
    }
  } catch (error) {
    console.error(`Error fetching SkidrowReloaded:`, error);
    if (isPageRequest) {
      return null;
    } else {
      throw error;
    }
  }
}

// Post transformation for v2
export async function transformPostForV2(post: WordPressPost, site: SiteConfig, fetchLinks = false): Promise<GamePost> {
  const downloadLinks = fetchLinks ? await extractDownloadLinksForV2(post.link, site.type) : [];
  
  // Enhanced image extraction
  let image = null;
  if (site.type === 'gamedrive') {
    image = post.featured_image_src || post.jetpack_featured_media_url;
  } else if (site.type === 'steamrip') {
    if (post.yoast_head_json?.og_image && post.yoast_head_json.og_image.length > 0) {
      image = post.yoast_head_json.og_image[0].url;
    }
  }
  
  // Fallback to content/excerpt image extraction
  if (!image) {
    image = extractImageFromContent(post.content?.rendered) || extractImageFromContent(post.excerpt?.rendered);
  }

  return {
    id: `${site.type}_${post.id}`,
    originalId: post.id,
    title: post.title?.rendered || 'No title',
    excerpt: stripHtml(post.excerpt?.rendered || ''),
    link: post.link,
    date: post.date,
    slug: post.slug,
    description: extractDescription(post.content?.rendered),
    categories: post.categories,
    tags: post.tags,
    downloadLinks,
    source: site.name,
    siteType: site.type,
    image
  };
}

// Extract download links for v2
export async function extractDownloadLinksForV2(postUrl: string, siteType = 'skidrow'): Promise<Array<{ service: string; url: string; type: string; text?: string }>> {
  try {
    let html;
    const downloadLinks: Array<{ service: string; url: string; type: string; text?: string }> = [];

    if (siteType === 'steamrip') {
      const response = await fetchSteamrip(postUrl, true);
      if (!response) {
        console.warn(`Failed to fetch post content from ${postUrl}`);
        return [];
      }
      html = await response.text();

      // Extract all href links from SteamRip
      const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
      let match;

      while ((match = hrefRegex.exec(html)) !== null) {
        let url = match[1].trim();
        const linkText = stripHtml(match[2]).trim();

        // Normalize protocol-relative URLs
        if (url.startsWith('//')) {
          url = 'https:' + url;
        }

        // Skip if this URL is already in our list
        if (downloadLinks.some(l => l.url === url)) continue;

        // Check if this is a valid download URL
        if (isValidDownloadUrl(url)) {
          const service = extractServiceName(url);
          downloadLinks.push({
            type: 'hosting',
            service: service,
            url: url,
            text: service
          });
        }

        // Check for torrent links
        if (url.startsWith('magnet:') || url.includes('.torrent')) {
          const torrentData = classifyTorrentLink(url, linkText);
          if (torrentData && !downloadLinks.some(l => l.url === url)) {
            downloadLinks.push(torrentData);
          }
        }
      }
    } else {
      // Handle other site types
      let response;
      if (siteType === 'skidrow') {
        response = await fetchSkidrow(postUrl, true);
      } else {
        response = await fetch(postUrl, {
          headers: {
            'User-Agent': 'Game-Search-API-v2-Link-Extractor/2.0'
          }
        });
      }

      if (!response || !response.ok) {
        console.warn(`Failed to fetch post content from ${postUrl}`);
        return [];
      }

      html = await response.text();

      // GameDrive specific handling
      if (siteType === 'gamedrive') {
        // Check for extras
        const extrasRegex = /\b(soundtrack|mp3)\b/i;
        if (extrasRegex.test(html)) {
          return [{
            type: 'manual',
            service: 'Manual Grab',
            url: postUrl,
            text: 'Post contains extras, grab manually'
          }];
        }

        // Extract crypt links (supports both .xyz and .to domains)
        const cryptRegex = /https?:\/\/crypt\.cybar\.(xyz|to)\/(?:link)?\#?([A-Za-z0-9_\-\+\/=]+)/gi;
        let match;
        while ((match = cryptRegex.exec(html)) !== null) {
          const domain = match[1]; // xyz or to
          const cryptId = match[2];
          const cryptUrl = `https://crypt.cybar.${domain}/link#${cryptId}`;
          if (!downloadLinks.some(l => l.url === cryptUrl)) {
            downloadLinks.push({
              type: 'crypt',
              service: 'Crypt',
              url: cryptUrl,
              text: 'Encrypted Link'
            });
          }
        }

        // Extract approved hosters
        const approvedHosters = [
          'mediafire.com', 'mega.nz', '1fichier.com', 'rapidgator.net',
          'uploaded.net', 'turbobit.net', 'nitroflare.com', 'katfile.com',
          'pixeldrain.com', 'gofile.io', 'mixdrop.to', 'krakenfiles.com',
          'filefactory.com', 'dailyuploads.net', 'multiup.io', 'drive.google.com',
          'dropbox.com', 'onedrive.live.com', 'hitfile.net', 'ufile.io',
          'clicknupload.site', '1337x.to'
        ];
        const hosterRegex = new RegExp(`<a[^>]+href=["'](https?://[^"']*(?:${approvedHosters.join('|')})[^"']*)["']`, 'gi');
        while ((match = hosterRegex.exec(html)) !== null) {
          const url = match[1];
          const service = extractServiceName(url);
          if (!downloadLinks.some(l => l.url === url)) {
            downloadLinks.push({
              type: 'hosting',
              service: service,
              url: url,
              text: service
            });
          }
        }

        // Extract torrent links
        const torrentRegex = /<a[^>]+href=["'](magnet:[^"']*?)["'][^>]*>([^<]*)<\/a>|<a[^>]+href=["'](https?:\/\/[^"']*\.torrent[^"']*?)["'][^>]*>([^<]*)<\/a>/gi;
        while ((match = torrentRegex.exec(html)) !== null) {
          let url = match[1] || match[3];
          const linkText = stripHtml(match[2] || match[4]).trim();
          
          // Decode HTML entities in magnet links (e.g., &#038; -> &)
          if (url && url.startsWith('magnet:')) {
            url = url.replace(/&#038;/g, '&')
                     .replace(/&amp;/g, '&')
                     .replace(/&#39;/g, "'")
                     .replace(/&quot;/g, '"');
          }
          
          if (url && !downloadLinks.some(l => l.url === url)) {
            const torrentData = classifyTorrentLink(url, linkText);
            if (torrentData) {
              downloadLinks.push(torrentData);
            }
          }
        }
      } else if (siteType === 'freegog' || siteType === 'skidrow') {
        // Extract links for FreeGOG and Skidrow
        console.log(`Extracting download links for ${siteType}, HTML length: ${html.length}`);
        
        // Debug: Check if HTML contains expected keywords
        const hasMega = html.toLowerCase().includes('mega');
        const hasMediafire = html.toLowerCase().includes('mediafire');
        const hasTorrent = html.toLowerCase().includes('torrent');
        console.log(`HTML contains: MEGA=${hasMega}, Mediafire=${hasMediafire}, Torrent=${hasTorrent}`);
        
        // Use a simpler regex that just extracts href values from <a> tags
        // This is more flexible and handles malformed HTML better
        const hrefRegex = /<a[^>]+href=["']([^"']+)["']/gi;
        let match;
        let linkCount = 0;
        while ((match = hrefRegex.exec(html)) !== null) {
          linkCount++;
          let url = match[1].trim();
          
          // Debug: Log first 5 URLs found
          if (linkCount <= 5) {
            console.log(`  Link ${linkCount}: ${url.substring(0, 80)}`);
          }
          
          // Log all URLs that might be download links
          if (url.includes('mediafire') || url.includes('mega') || url.includes('torrent')) {
            console.log(`Regex matched potential download URL: ${url}`);
          }

          if (url.startsWith('//')) {
            url = 'https:' + url;
          }

          if (downloadLinks.some(l => l.url === url)) continue;

          if (isValidDownloadUrl(url)) {
            console.log(`Found valid download URL: ${url}`);
            const service = extractServiceName(url);
            downloadLinks.push({
              type: 'hosting',
              service: service,
              url: url,
              text: service
            });
          } else if (url.includes('mediafire') || url.includes('mega')) {
            console.log(`URL failed validation but contains hosting service: ${url}`);
          }

          if (url.startsWith('magnet:') || url.includes('.torrent')) {
            // Decode HTML entities in magnet links
            if (url.startsWith('magnet:')) {
              url = url.replace(/&#038;/g, '&')
                       .replace(/&amp;/g, '&')
                       .replace(/&#39;/g, "'")
                       .replace(/&quot;/g, '"');
            }
            const torrentData = classifyTorrentLink(url, '');
            if (torrentData && !downloadLinks.some(l => l.url === url)) {
              downloadLinks.push(torrentData);
            }
          }
        }
        console.log(`Total links scanned: ${linkCount}, valid download links found: ${downloadLinks.length}`);
      }
    }

    return downloadLinks;
  } catch (error) {
    console.error(`Error extracting download links from ${postUrl}:`, error);
    return [];
  }
}

function extractImageFromContent(content: string | undefined | null): string | null {
  if (!content) return null;
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/i;
  const match = imgRegex.exec(content);
  return match ? match[1] : null;
}

function extractDescription(content: string | undefined | null): string {
  if (!content) return '';
  const stripped = stripHtml(content);
  return stripped.length > 300 ? stripped.substring(0, 300) + '...' : stripped;
}

function isValidDownloadUrl(url: string): boolean {
  const validDomains = [
    'mega.nz', 'mediafire.com', '1fichier.com', 'rapidgator.net',
    'uploaded.net', 'turbobit.net', 'nitroflare.com', 'katfile.com',
    'pixeldrain.com', 'gofile.io', 'mixdrop.to', 'krakenfiles.com',
    'filefactory.com', 'dailyuploads.net', 'multiup.io', 'drive.google.com',
    'dropbox.com', 'onedrive.live.com', 'hitfile.net', 'ufile.io',
    'clicknupload.site', 'clicknupload.click', '1337x.to', 'uploadhaven.com'
  ];
  
  try {
    const urlObj = new URL(url);
    return validDomains.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

export function isValidImageUrl(url: unknown): boolean {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const urlObj = new URL(url);
    
    // Block known invalid patterns
    const invalidPatterns = [
      /wordpress\.com\/s2\/images\/smile\//,  // Emoji images
      /gravatar\.com/,                          // Gravatar avatars
      /s\.w\.org\/images\/core\/emoji\//,      // WordPress emoji
      /tracking/i,                              // Tracking pixels
      /beacon/i,                                // Analytics beacons
      /pixel/i                                  // Tracking pixels
    ];
    
    // Check if URL matches any invalid pattern
    if (invalidPatterns.some(pattern => pattern.test(url))) {
      return false;
    }
    
    // Check for common image extensions or image-like URLs
    const path = urlObj.pathname.toLowerCase();
    const hasImageExtension = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)(\?.*)?$/i.test(path);
    const isImagePath = path.includes('image') || path.includes('photo') || path.includes('picture');
    const isUploadPath = path.includes('upload') || path.includes('wp-content') || path.includes('media');
    
    // Allow if it has image extension or looks like an image URL
    return hasImageExtension || isImagePath || isUploadPath;
    
  } catch {
    return false;
  }
}
