/**
 * Game Search API v2 - Core Library
 * Shared logic for Vercel and Docker deployments
 */

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
let steamripCookie = {
  cf_clearance: null,
  cookies: [], // Store all cookies from FlareSolverr
  userAgent: null, // Store the User-Agent used by FlareSolverr
  expires_at: 0
};

let skidrowCookie = {
  cf_clearance: null,
  cookies: [],
  userAgent: null,
  expires_at: 0
};

let dodiCookie = {
  cf_clearance: null,
  cookies: [],
  userAgent: null,
  expires_at: 0
};

const SKIDROW_COOLDOWN_MS = Math.max(30000, parseInt(process.env.SKIDROW_COOLDOWN_MS || '300000', 10) || 300000);
let skidrowCircuit = {
  cooldownUntil: 0,
  failures: 0,
  lastError: null,
};

function isSkidrowCircuitOpen() {
  return Date.now() < skidrowCircuit.cooldownUntil;
}

function noteSkidrowFailure(error) {
  skidrowCircuit.failures += 1;
  skidrowCircuit.lastError = String(error?.message || error || 'unknown error');
  skidrowCircuit.cooldownUntil = Date.now() + SKIDROW_COOLDOWN_MS;
  console.warn(`Skidrow circuit opened for ${Math.round(SKIDROW_COOLDOWN_MS / 1000)}s after failure #${skidrowCircuit.failures}: ${skidrowCircuit.lastError}`);
}

function resetSkidrowCircuit() {
  if (skidrowCircuit.failures > 0 || skidrowCircuit.cooldownUntil > 0) {
    console.log('Skidrow circuit reset after successful response');
  }
  skidrowCircuit = {
    cooldownUntil: 0,
    failures: 0,
    lastError: null,
  };
}

// DODI circuit breaker (same pattern as Skidrow)
const DODI_COOLDOWN_MS = Math.max(30000, parseInt(process.env.DODI_COOLDOWN_MS || '300000', 10) || 300000);
let dodiCircuit = {
  cooldownUntil: 0,
  failures: 0,
  lastError: null,
};

function isDodiCircuitOpen() {
  return Date.now() < dodiCircuit.cooldownUntil;
}

function noteDodiFailure(error) {
  dodiCircuit.failures += 1;
  dodiCircuit.lastError = String(error?.message || error || 'unknown error');
  dodiCircuit.cooldownUntil = Date.now() + DODI_COOLDOWN_MS;
  console.warn(`DODI circuit opened for ${Math.round(DODI_COOLDOWN_MS / 1000)}s after failure #${dodiCircuit.failures}: ${dodiCircuit.lastError}`);
}

function resetDodiCircuit() {
  if (dodiCircuit.failures > 0 || dodiCircuit.cooldownUntil > 0) {
    console.log('DODI circuit reset after successful response');
  }
  dodiCircuit = {
    cooldownUntil: 0,
    failures: 0,
    lastError: null,
  };
}

// Timeout and retry helpers
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(resource, options = {}, timeoutMs = DEFAULT_FLARE_TIMEOUT_MS) {
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

export async function retryableFetch(resource, options = {}, attempts = DEFAULT_FLARE_RETRIES, timeoutMs = DEFAULT_FLARE_TIMEOUT_MS) {
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
export const MAX_POSTS_PER_SITE = {
  'skidrow': 40,
  'gamedrive': 40,
  'steamrip': 40,
  'freegog': 40,
  'reloadedsteam': 40,
  'steamunderground': 40,
  'onlinefix': 40,
  'goggames': 50,
  'dodi': 40,
  'default': 50
};

// Site configurations
export const SITE_CONFIGS = {
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
  },
  'reloadedsteam': {
    baseUrl: 'https://reloadedsteam.com/wp-json/wp/v2/posts',
    type: 'reloadedsteam',
    name: 'ReloadedSteam'
  },
  'steamunderground': {
    baseUrl: 'https://steamunderground.net/wp-json/wp/v2/posts',
    type: 'steamunderground',
    name: 'SteamUnderground'
  },
  'onlinefix': {
    baseUrl: 'https://online-fix.me',
    type: 'onlinefix',
    name: 'Online-Fix'
  },
  'goggames': {
    baseUrl: 'https://gog-games.to/api/web/recent-torrents',
    type: 'goggames',
    name: 'GOG-Games'
  },
  'dodi': {
    baseUrl: 'https://dodi-repacks.download/wp-json/wp/v2/posts',
    fallbackBaseUrl: 'https://dodi-repacks.site/wp-json/wp/v2/posts',
    type: 'dodi',
    name: 'DODI-Repacks'
  }
};

// Helper functions
export function stripHtml(html) {
  // Handle cases where html might be an object with a 'rendered' property
  if (typeof html === 'object' && html !== null) {
    html = html.rendered || '';
  }
  // Ensure we have a string
  if (typeof html !== 'string') {
    return '';
  }
  return html.replace(/<[^>]*>?/gm, '');
}

export function getSiteConfig(siteType) {
  return SITE_CONFIGS[siteType] || null;
}

export function extractServiceName(url) {
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
    if (host.includes('datavaults')) return 'DataVaults';
    if (host.includes('vikingfile')) return 'VikingFile';
    if (host.includes('akirabox')) return 'AkiraBox';
    if (host.includes('filecrypt')) return 'FileCrypt';
    if (host.includes('hitfile')) return 'HitFile';
    if (host.includes('ufile')) return 'UFile';
    if (host.includes('clicknupload')) return 'ClicknUpload';
    if (host.includes('up-4ever') || host.includes('up4ever')) return 'Up-4ever';
    if (host.includes('dayuploads')) return 'DayUploads';
    if (host.includes('dlupload')) return 'DLUpload';
    if (host.includes('file-upload')) return 'File-Upload';
    if (host.includes('filespayouts')) return 'FilesPayouts';
    if (host.includes('swiftuploads')) return 'SwiftUploads';
    if (host.includes('linkmix')) return 'LinkMix';
    if (host.includes('pasteform') || host.includes('paste-form')) return 'PasteForm';
    if (host.includes('file-me')) return 'FileMe';
    if (host.includes('loot-link') || host.includes('lootdest') || host.includes('loot-links')) return 'LootLink';
    
    return host;
  } catch {
    if (url.includes('megadb')) return 'MegaDB';
    if (url.includes('buzzheavier')) return 'BuzzHeavier';
    if (url.includes('datanodes')) return 'DataNodes';
    if (url.includes('datavaults')) return 'DataVaults';
    if (url.includes('vikingfile')) return 'VikingFile';
    if (url.includes('akirabox')) return 'AkiraBox';
    if (url.includes('filecrypt')) return 'FileCrypt';
    if (url.includes('hitfile')) return 'HitFile';
    if (url.includes('ufile')) return 'UFile';
    if (url.includes('clicknupload')) return 'ClicknUpload';
    if (url.includes('swiftuploads')) return 'SwiftUploads';
    if (url.includes('file-me')) return 'FileMe';
    return 'Unknown';
  }
}

export function classifyTorrentLink(url, linkText = '') {
  const _cleanText = stripHtml(linkText).trim();
  
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
export async function getFreshSteamripCookie() {
  console.log('Getting fresh cf_clearance cookie for SteamRip');

  try {
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (!flaresolverrUrl) {
      throw new Error('FLARESOLVERR_URL environment variable is required for SteamRip. Please set it to your FlareSolverr instance URL (e.g., http://localhost:8191/v1)');
    }
    
    const attempts = parseInt(process.env.FLARE_RETRIES || DEFAULT_FLARE_RETRIES, 10) || DEFAULT_FLARE_RETRIES;
    const timeoutMs = parseInt(process.env.FLARE_TIMEOUT_MS || DEFAULT_FLARE_TIMEOUT_MS, 10) || DEFAULT_FLARE_TIMEOUT_MS;

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
    let cf_clearance = null;
    let expires_at = Date.now() + (4 * 60 * 60 * 1000); // Default 4 hours from now
    const allCookies = [];

    if (data.solution.cookies && Array.isArray(data.solution.cookies)) {
      // Store all cookies
      data.solution.cookies.forEach(cookie => {
        allCookies.push(`${cookie.name}=${cookie.value}`);
        if (cookie.name === 'cf_clearance') {
          cf_clearance = cookie.value;
          if (cookie.expires) {
            expires_at = new Date(cookie.expires * 1000).getTime();
          }
        }
      });

      if (cf_clearance) {
        console.log('Successfully obtained cf_clearance cookie:', cf_clearance.substring(0, 20) + '...');
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

export async function getValidSteamripCookie() {
  if (!steamripCookie.cf_clearance || Date.now() >= steamripCookie.expires_at) {
    return await getFreshSteamripCookie();
  }
  return steamripCookie;
}

export async function fetchSteamrip(url, isPageRequest = false) {
  try {
    const userAgent = isPageRequest ? 'GameSearch-API-v2-PageFetch/2.0' : 'GameSearch-API-v2/2.0';

    // Try direct fetch first (like skidrow) — avoids FlareSolverr delay when CF is not active
    let response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    // Check for Cloudflare protection — even if status is 200
    let isCloudflare = hasCloudflareProtection(response);
    console.log(`Initial fetch of ${url}: status=${response.status}, CF detected=${isCloudflare}`);

    // If response looks OK but is HTML, check content for CF protection
    if (!isCloudflare && response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const text = await response.text();
      isCloudflare = hasCloudflareProtection(response, text);

      if (!isCloudflare) {
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    } else if (!isCloudflare && response.ok) {
      return response;
    }

    // Cloudflare protection detected — try with cached cookie
    if (isCloudflare) {
      console.log('Cloudflare protection detected on SteamRip, using FlareSolverr cookie');
      const cookie = await getValidSteamripCookie();

      const cookieUserAgent = cookie.userAgent || userAgent;
      const cookieString = cookie.cookies.join('; ');

      response = await fetch(url, {
        headers: {
          'User-Agent': cookieUserAgent,
          'Cookie': cookieString,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://steamrip.com/',
          'Origin': 'https://steamrip.com'
        }
      });

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

      // Cached cookie didn't work — get a fresh one
      if (stillBlocked || response.status === 403) {
        console.log('Cookie did not bypass Cloudflare, getting fresh cookie for SteamRip');
        const freshCookie = await getFreshSteamripCookie();
        const freshUserAgent = freshCookie.userAgent || userAgent;
        const freshCookieString = freshCookie.cookies.join('; ');

        const retryResponse = await fetch(url, {
          headers: {
            'User-Agent': freshUserAgent,
            'Cookie': freshCookieString,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://steamrip.com/',
            'Origin': 'https://steamrip.com'
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
export async function getFreshSkidrowCookie() {
  console.log('Getting fresh cf_clearance cookie for SkidrowReloaded');

  try {
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (!flaresolverrUrl) {
      throw new Error('FLARESOLVERR_URL environment variable is required for SkidrowReloaded. Please set it to your FlareSolverr instance URL (e.g., http://localhost:8191/v1)');
    }
    
    const attempts = Math.max(1, parseInt(process.env.FLARE_RETRIES || '1', 10) || 1);
    const timeoutMs = Math.min(25000, parseInt(process.env.FLARE_TIMEOUT_MS || DEFAULT_FLARE_TIMEOUT_MS, 10) || DEFAULT_FLARE_TIMEOUT_MS);

    // Ask FlareSolverr to request the Skidrow REST API endpoint (wp-json)
    // Requesting the actual API endpoint (instead of the site root) often
    // produces more useful cookies and avoids landing on CF challenge pages.
    const response = await retryableFetch(flaresolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cmd: 'request.get',
        url: 'https://www.skidrowreloaded.com/wp-json/wp/v2/posts',
        session: 'skidrowreloaded',
        // Let FlareSolverr know the desired timeout for rendering/solving
        maxTimeout: timeoutMs
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

    let cf_clearance = null;
    let expires_at = Date.now() + (4 * 60 * 60 * 1000);
    const allCookies = [];

    if (data.solution.cookies && Array.isArray(data.solution.cookies)) {
      data.solution.cookies.forEach(cookie => {
        allCookies.push(`${cookie.name}=${cookie.value}`);
        if (cookie.name === 'cf_clearance') {
          cf_clearance = cookie.value;
          if (cookie.expires) {
            expires_at = new Date(cookie.expires * 1000).getTime();
          }
        }
      });

      console.log(`Cookies received: ${data.solution.cookies.map(c => c.name).join(', ')}`);
      
      if (cf_clearance) {
        console.log('Successfully obtained cf_clearance cookie for SkidrowReloaded:', cf_clearance.substring(0, 20) + '...');
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

export async function getValidSkidrowCookie() {
  if (!skidrowCookie.cf_clearance || Date.now() >= skidrowCookie.expires_at) {
    return await getFreshSkidrowCookie();
  }
  return skidrowCookie;
}

// FlareSolverr cookie management for DODI Repacks
export async function getFreshDodiCookie() {
  console.log('Getting fresh cf_clearance cookie for DODI Repacks');

  try {
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (!flaresolverrUrl) {
      throw new Error('FLARESOLVERR_URL environment variable is required for DODI Repacks');
    }

    const attempts = Math.max(1, parseInt(process.env.FLARE_RETRIES || '1', 10) || 1);
    const timeoutMs = Math.min(25000, parseInt(process.env.FLARE_TIMEOUT_MS || DEFAULT_FLARE_TIMEOUT_MS, 10) || DEFAULT_FLARE_TIMEOUT_MS);

    const response = await retryableFetch(flaresolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cmd: 'request.get',
        url: 'https://dodi-repacks.site/wp-json/wp/v2/posts',
        session: 'dodirepacks',
        maxTimeout: timeoutMs
      })
    }, attempts, timeoutMs);

    if (!response.ok) {
      throw new Error(`FlareSolverr request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'ok') {
      throw new Error(`FlareSolverr error: ${data.message}`);
    }

    console.log(`FlareSolverr response for DODI: status=${data.status}, cookies=${data.solution?.cookies?.length || 0}`);

    let cf_clearance = null;
    let expires_at = Date.now() + (4 * 60 * 60 * 1000);
    const allCookies = [];

    if (data.solution.cookies && Array.isArray(data.solution.cookies)) {
      data.solution.cookies.forEach(cookie => {
        allCookies.push(`${cookie.name}=${cookie.value}`);
        if (cookie.name === 'cf_clearance') {
          cf_clearance = cookie.value;
          if (cookie.expires) {
            expires_at = new Date(cookie.expires * 1000).getTime();
          }
        }
      });

      if (cf_clearance) {
        console.log('Successfully obtained cf_clearance cookie for DODI:', cf_clearance.substring(0, 20) + '...');
      }
    }

    if (!cf_clearance && allCookies.length > 0) {
      console.log('No cf_clearance cookie found for DODI, but using other cookies from FlareSolverr');
    } else if (!cf_clearance && allCookies.length === 0) {
      console.log('No cookies returned from FlareSolverr for DODI - Cloudflare protection may not be active');
      cf_clearance = 'none';
    } else if (!cf_clearance) {
      throw new Error('Failed to extract cf_clearance cookie from FlareSolverr response for DODI');
    }

    const userAgent = data.solution.userAgent || 'GameSearch-API-v2/2.0';

    dodiCookie = {
      cf_clearance: cf_clearance,
      cookies: allCookies,
      userAgent: userAgent,
      expires_at: expires_at
    };

    return dodiCookie;
  } catch (error) {
    console.error('Error getting fresh DODI cookie:', error);
    throw error;
  }
}

export async function getValidDodiCookie() {
  if (!dodiCookie.cf_clearance || Date.now() >= dodiCookie.expires_at) {
    return await getFreshDodiCookie();
  }
  return dodiCookie;
}

// Fetch a URL via FlareSolverr and return the response body directly
export async function fetchViaFlaresolverr(url, session = 'default') {
  const flaresolverrUrl = process.env.FLARESOLVERR_URL;
  if (!flaresolverrUrl) return null;

  const timeoutMs = Math.min(25000, parseInt(process.env.FLARE_TIMEOUT_MS || DEFAULT_FLARE_TIMEOUT_MS, 10) || DEFAULT_FLARE_TIMEOUT_MS);

  try {
    console.log(`Fetching via FlareSolverr: ${url}`);
    const response = await retryableFetch(flaresolverrUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url,
        session,
        maxTimeout: timeoutMs
      })
    }, 1, timeoutMs + 5000);

    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 'ok' || !data.solution?.response) return null;

    let body = data.solution.response;
    const status = data.solution.status || 200;

    // FlareSolverr wraps JSON API responses in HTML: <html>...<pre>[{...}]</pre></html>
    // Strip the HTML wrapper to get raw JSON
    const preMatch = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (preMatch) {
      body = preMatch[1];
    }

    console.log(`FlareSolverr returned ${body.length} chars, status ${status} for ${url}`);

    // Update cookies from the solution while we're at it
    if (data.solution.cookies?.length && (session === 'skidrowreloaded' || session === 'dodirepacks' || session === 'dodirepacks-fallback')) {
      const allCookies = data.solution.cookies.map(c => `${c.name}=${c.value}`);
      let cf = null;
      let exp = Date.now() + (4 * 60 * 60 * 1000);
      for (const c of data.solution.cookies) {
        if (c.name === 'cf_clearance') { cf = c.value; if (c.expires) exp = new Date(c.expires * 1000).getTime(); }
      }
      if (session === 'skidrowreloaded') {
        skidrowCookie = { cf_clearance: cf || 'none', cookies: allCookies, userAgent: data.solution.userAgent || null, expires_at: exp };
      } else {
        dodiCookie = { cf_clearance: cf || 'none', cookies: allCookies, userAgent: data.solution.userAgent || null, expires_at: exp };
      }
    }

    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(`FlareSolverr direct fetch failed for ${url}:`, error.message);
    return null;
  }
}

// Helper function to detect Cloudflare protection in response
function hasCloudflareProtection(response, htmlContent = null) {
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

export async function fetchSkidrow(url, isPageRequest = false) {
  if (isSkidrowCircuitOpen()) {
    const remainingMs = skidrowCircuit.cooldownUntil - Date.now();
    console.warn(`Skidrow circuit open (${Math.max(0, Math.ceil(remainingMs / 1000))}s remaining), trying FlareSolverr direct`);
    // Circuit is open but FlareSolverr can still bypass CF
    const flareResponse = await fetchViaFlaresolverr(url, 'skidrowreloaded');
    if (flareResponse && flareResponse.ok) {
      resetSkidrowCircuit();
      return flareResponse;
    }
    return isPageRequest ? null : new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

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

    // Cloudflare protection detected — use FlareSolverr to fetch directly first
    if (isCloudflare) {
      console.log('Cloudflare protection detected on Skidrow, trying FlareSolverr direct fetch');

      // Primary strategy: let FlareSolverr fetch the URL directly
      const flareResponse = await fetchViaFlaresolverr(url, 'skidrowreloaded');
      if (flareResponse && flareResponse.ok) {
        resetSkidrowCircuit();
        return flareResponse;
      }

      // Fallback: try cookie-based fetch
      console.log('FlareSolverr direct fetch failed, falling back to cookie approach');
      const cookie = await getValidSkidrowCookie();
      
      if (cookie.cf_clearance !== 'none' || cookie.cookies.length > 0) {
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

        let stillBlocked = hasCloudflareProtection(response);
        console.log(`After cookie fetch: status=${response.status}, stillBlocked=${stillBlocked}, cookies used=${cookie.cookies.length}`);
        
        if (!stillBlocked && response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const text = await response.text();
          stillBlocked = hasCloudflareProtection(response, text);
          if (!stillBlocked) {
            resetSkidrowCircuit();
            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          }
        } else if (!stillBlocked && response.ok) {
          resetSkidrowCircuit();
          return response;
        }
      }

      // Everything failed
      if (isPageRequest) {
        console.warn(`Failed to fetch SkidrowReloaded page (all methods exhausted)`);
        return null;
      } else {
        throw new Error(`SkidrowReloaded: all fetch methods failed (CF blocking)`);
      }
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
    noteSkidrowFailure(error);
    if (isPageRequest) {
      return null;
    } else {
      // Fail open for site-level fetch errors so other providers still return data.
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

// DODI Repacks fetcher — CF-protected WordPress site, uses FlareSolverr
// Primary: dodi-repacks.download, Fallback: dodi-repacks.site
export async function fetchDodi(url, isPageRequest = false) {
  if (isDodiCircuitOpen()) {
    const remainingMs = dodiCircuit.cooldownUntil - Date.now();
    console.warn(`DODI circuit open (${Math.max(0, Math.ceil(remainingMs / 1000))}s remaining), trying FlareSolverr direct`);
    const flareResponse = await fetchViaFlaresolverr(url, 'dodirepacks');
    if (flareResponse && flareResponse.ok) {
      resetDodiCircuit();
      return flareResponse;
    }
    // Try fallback domain
    const fallbackUrl = url.replace('dodi-repacks.download', 'dodi-repacks.site');
    if (fallbackUrl !== url) {
      console.log('Trying DODI fallback domain...');
      const fallbackResponse = await fetchViaFlaresolverr(fallbackUrl, 'dodirepacks-fallback');
      if (fallbackResponse && fallbackResponse.ok) {
        resetDodiCircuit();
        return fallbackResponse;
      }
    }
    // Try cookie-based fetch as last resort
    if (dodiCookie.cf_clearance && Date.now() < dodiCookie.expires_at) {
      const cookieString = dodiCookie.cookies.join('; ');
      const cookieUserAgent = dodiCookie.userAgent || 'GameSearch-API-v2/2.0';
      try {
        const cookieResponse = await fetch(url, {
          headers: {
            'User-Agent': cookieUserAgent,
            'Cookie': cookieString,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://dodi-repacks.site/',
            'Origin': 'https://dodi-repacks.site'
          }
        });
        if (!hasCloudflareProtection(cookieResponse) && cookieResponse.ok) {
          resetDodiCircuit();
          return cookieResponse;
        }
      } catch (e) {
        console.warn('DODI cookie fetch in circuit-open path failed:', e.message);
      }
    }
    return isPageRequest ? null : new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

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

    let isCloudflare = hasCloudflareProtection(response);
    console.log(`Initial DODI fetch of ${url}: status=${response.status}, CF detected=${isCloudflare}`);

    if (!isCloudflare && response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const text = await response.text();
      isCloudflare = hasCloudflareProtection(response, text);
      if (!isCloudflare) {
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    } else if (!isCloudflare && response.ok) {
      return response;
    }

    if (isCloudflare) {
      console.log('Cloudflare protection detected on DODI, trying FlareSolverr direct fetch');

      // Primary: FlareSolverr on primary domain
      const flareResponse = await fetchViaFlaresolverr(url, 'dodirepacks');
      if (flareResponse && flareResponse.ok) {
        // Store DODI cookies from FlareSolverr response
        resetDodiCircuit();
        return flareResponse;
      }

      // Fallback 1: try the alternate domain via FlareSolverr
      const fallbackUrl = url.replace('dodi-repacks.download', 'dodi-repacks.site');
      if (fallbackUrl !== url) {
        console.log('Primary DODI domain failed, trying fallback domain via FlareSolverr...');
        const fallbackResponse = await fetchViaFlaresolverr(fallbackUrl, 'dodirepacks-fallback');
        if (fallbackResponse && fallbackResponse.ok) {
          resetDodiCircuit();
          return fallbackResponse;
        }
      }

      // Fallback 2: try cookie-based fetch (like skidrow)
      console.log('FlareSolverr direct fetch failed for DODI, falling back to cookie approach');
      try {
        const cookie = await getValidDodiCookie();

        if (cookie.cf_clearance !== 'none' || cookie.cookies.length > 0) {
          const cookieUserAgent = cookie.userAgent || userAgent;
          const cookieString = cookie.cookies.join('; ');

          // Try primary domain with cookies
          let cookieResponse = await fetch(url, {
            headers: {
              'User-Agent': cookieUserAgent,
              'Cookie': cookieString,
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://dodi-repacks.site/',
              'Origin': 'https://dodi-repacks.site'
            }
          });

          let stillBlocked = hasCloudflareProtection(cookieResponse);
          console.log(`After DODI cookie fetch: status=${cookieResponse.status}, stillBlocked=${stillBlocked}, cookies used=${cookie.cookies.length}`);

          if (!stillBlocked && cookieResponse.ok && cookieResponse.headers.get('content-type')?.includes('text/html')) {
            const text = await cookieResponse.text();
            stillBlocked = hasCloudflareProtection(cookieResponse, text);
            if (!stillBlocked) {
              resetDodiCircuit();
              return new Response(text, {
                status: cookieResponse.status,
                statusText: cookieResponse.statusText,
                headers: cookieResponse.headers
              });
            }
          } else if (!stillBlocked && cookieResponse.ok) {
            resetDodiCircuit();
            return cookieResponse;
          }

          // Try fallback domain with cookies
          if (fallbackUrl !== url) {
            cookieResponse = await fetch(fallbackUrl, {
              headers: {
                'User-Agent': cookieUserAgent,
                'Cookie': cookieString,
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://dodi-repacks.site/',
                'Origin': 'https://dodi-repacks.site'
              }
            });

            stillBlocked = hasCloudflareProtection(cookieResponse);
            if (!stillBlocked && cookieResponse.ok && cookieResponse.headers.get('content-type')?.includes('text/html')) {
              const text = await cookieResponse.text();
              stillBlocked = hasCloudflareProtection(cookieResponse, text);
              if (!stillBlocked) {
                resetDodiCircuit();
                return new Response(text, {
                  status: cookieResponse.status,
                  statusText: cookieResponse.statusText,
                  headers: cookieResponse.headers
                });
              }
            } else if (!stillBlocked && cookieResponse.ok) {
              resetDodiCircuit();
              return cookieResponse;
            }
          }
        }
      } catch (cookieError) {
        console.warn('DODI cookie-based fetch failed:', cookieError.message);
      }

      // Everything failed
      if (isPageRequest) {
        console.warn('Failed to fetch DODI page (all methods exhausted)');
        return null;
      } else {
        throw new Error('DODI-Repacks: all fetch methods failed (CF blocking)');
      }
    } else {
      if (isPageRequest) {
        console.warn(`Failed to fetch DODI page: ${response.status} ${response.statusText}`);
        return null;
      } else {
        throw new Error(`DODI-Repacks API returned ${response.status}: ${response.statusText}`);
      }
    }
  } catch (error) {
    console.error('Error fetching DODI-Repacks:', error);
    noteDodiFailure(error);
    if (isPageRequest) {
      return null;
    } else {
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

// Post transformation for v2
export async function transformPostForV2(post, site, fetchLinks = false) {
  const downloadLinks = fetchLinks ? await extractDownloadLinksForV2(post.link, site.type, post.content?.rendered) : [];
  
  // Enhanced image extraction.
  // NOTE: skidrow images are served by a Cloudflare-protected host; previously
  // we skipped them entirely because the browser couldn't load them. Now that
  // /api/proxy-image forwards requests with the FlareSolverr-issued cf_clearance
  // cookie, skidrow images load correctly and we treat them like every other
  // site.
  let image = null;
  if (site.type === 'gamedrive') {
    image = post.featured_image_src || post.jetpack_featured_media_url;
  } else if (
    site.type === 'steamrip' ||
    site.type === 'reloadedsteam' ||
    site.type === 'steamunderground' ||
    site.type === 'skidrow'
  ) {
    if (post.yoast_head_json?.og_image && post.yoast_head_json.og_image.length > 0) {
      image = post.yoast_head_json.og_image[0].url;
    }
  }

  // Fallback to content/excerpt image extraction for any site that didn't
  // already produce an image above.
  if (!image) {
    image = extractImageFromContent(post.content?.rendered) || extractImageFromContent(post.excerpt?.rendered);
  }

  return {
    id: `${site.type}_${post.id}`,
    originalId: post.id,
    title: decodeBasicHtmlEntities(post.title?.rendered || 'No title'),
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
export async function extractDownloadLinksForV2(postUrl, siteType = 'skidrow', wpContent = null) {
  try {
    let html;
    const downloadLinks = [];

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
      } else if (siteType === 'dodi') {
        response = await fetchDodi(postUrl, true);
      } else {
        response = await fetch(postUrl, {
          headers: {
            'User-Agent': 'Game-Search-API-v2-Link-Extractor/2.0'
          }
        });
      }

      if (response && response.ok) {
        html = await response.text();
      } else if (wpContent) {
        // Fall back to WP REST API content if page fetch fails
        console.warn(`Page fetch failed for ${postUrl}, using WP API content`);
        html = wpContent;
      } else {
        console.warn(`Failed to fetch post content from ${postUrl}`);
        return [];
      }

      // GameDrive specific handling
      if (siteType === 'onlinefix') {
        const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
        let match;

        while ((match = hrefRegex.exec(html)) !== null) {
          let url = decodeBasicHtmlEntities(match[1] || '').trim();
          if (!url) continue;

          if (url.startsWith('//')) {
            url = `https:${url}`;
          } else if (url.startsWith('/')) {
            url = `${ONLINE_FIX_BASE}${url}`;
          }

          if (downloadLinks.some(l => l.url === url)) continue;

          const isOfmeLink = /ofme/i.test(url) || /\/engine\/go\.php\?url=/i.test(url);
          if (isOfmeLink || isValidDownloadUrl(url)) {
            const service = isOfmeLink ? 'OFME' : extractServiceName(url);
            downloadLinks.push({
              type: 'hosting',
              service,
              url,
              text: service
            });
          }
        }
      } else if (siteType === 'gamedrive') {
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
          'clicknupload.site', '1337x.to',
          'datanodes.to', 'datavaults.co', 'vikingfile.com', 'akirabox.com'
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
      } else if (siteType === 'reloadedsteam') {
        // ReloadedSteam uses styled buttons linking to datanodes.to / datavaults.co / vikingfile.com / gofile.io
        const hrefRegex = /<a[^>]+href=["']([^"']+)["']/gi;
        let match;
        while ((match = hrefRegex.exec(html)) !== null) {
          let url = match[1].trim();

          if (url.startsWith('//')) {
            url = 'https:' + url;
          }

          if (downloadLinks.some(l => l.url === url)) continue;

          if (isValidDownloadUrl(url)) {
            const service = extractServiceName(url);
            downloadLinks.push({
              type: 'hosting',
              service: service,
              url: url,
              text: service
            });
          }

          if (url.startsWith('magnet:') || url.includes('.torrent')) {
            if (url.startsWith('magnet:')) {
              url = url.replace(/&#038;/g, '&')
                       .replace(/&amp;/g, '&');
            }
            const torrentData = classifyTorrentLink(url, '');
            if (torrentData && !downloadLinks.some(l => l.url === url)) {
              downloadLinks.push(torrentData);
            }
          }
        }
      } else if (siteType === 'steamunderground') {
        // SteamUnderground uses styled buttons linking to datanodes.to / akirabox.com
        const hrefRegex2 = /<a[^>]+href=["']([^"']+)["']/gi;
        let match2;
        while ((match2 = hrefRegex2.exec(html)) !== null) {
          let url = match2[1].trim();

          if (url.startsWith('//')) {
            url = 'https:' + url;
          }

          if (downloadLinks.some(l => l.url === url)) continue;

          if (isValidDownloadUrl(url)) {
            const service = extractServiceName(url);
            downloadLinks.push({
              type: 'hosting',
              service: service,
              url: url,
              text: service
            });
          }

          if (url.startsWith('magnet:') || url.includes('.torrent')) {
            if (url.startsWith('magnet:')) {
              url = url.replace(/&#038;/g, '&')
                       .replace(/&amp;/g, '&');
            }
            const torrentData = classifyTorrentLink(url, '');
            if (torrentData && !downloadLinks.some(l => l.url === url)) {
              downloadLinks.push(torrentData);
            }
          }
        }
      } else if (siteType === 'dodi') {
        // DODI Repacks — magnet links and file hosting (similar structure to reloadedsteam)
        const hrefRegex = /<a[^>]+href=["']([^"']+)["']/gi;
        let match;
        while ((match = hrefRegex.exec(html)) !== null) {
          let url = match[1].trim();

          if (url.startsWith('//')) {
            url = 'https:' + url;
          }

          if (downloadLinks.some(l => l.url === url)) continue;

          if (isValidDownloadUrl(url)) {
            const service = extractServiceName(url);
            downloadLinks.push({
              type: 'hosting',
              service: service,
              url: url,
              text: service
            });
          }

          if (url.startsWith('magnet:') || url.includes('.torrent')) {
            if (url.startsWith('magnet:')) {
              url = url.replace(/&#038;/g, '&')
                       .replace(/&amp;/g, '&');
            }
            const torrentData = classifyTorrentLink(url, '');
            if (torrentData && !downloadLinks.some(l => l.url === url)) {
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

          // FreeGOG download-gen.php links are usable download pages
          if (siteType === 'freegog' && url.includes('gdl.freegogpcgames.xyz/')) {
            if (!downloadLinks.some(l => l.url === url)) {
              downloadLinks.push({ type: 'direct', service: 'FreeGOG', url: url, text: 'FreeGOG Download' });
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

function extractImageFromContent(content) {
  if (!content) return null;
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/i;
  const match = imgRegex.exec(content);
  return match ? match[1] : null;
}

function extractDescription(content) {
  if (!content) return '';
  const stripped = stripHtml(content);
  return stripped.length > 300 ? stripped.substring(0, 300) + '...' : stripped;
}

function isValidDownloadUrl(url) {
  const validDomains = [
    'mega.nz', 'mediafire.com', '1fichier.com', 'rapidgator.net',
    'uploaded.net', 'turbobit.net', 'nitroflare.com', 'katfile.com',
    'pixeldrain.com', 'gofile.io', 'mixdrop.to', 'krakenfiles.com',
    'filefactory.com', 'dailyuploads.net', 'multiup.io', 'drive.google.com',
    'dropbox.com', 'onedrive.live.com', 'hitfile.net', 'ufile.io',
    'clicknupload.site', 'clicknupload.click', '1337x.to', 'uploadhaven.com',
    'datanodes.to', 'datavaults.co', 'vikingfile.com', 'akirabox.com',
    // DODI-common hosters
    'buzzheavier.com', 'filecrypt.co', 'filecrypt.cc', 'up-4ever.net',
    'dayuploads.com', 'dlupload.com', 'file-upload.org', 'filespayouts.com',
    'swiftuploads.com', 'linkmix.co', 'pasteform.com', 'paste-form.com',
    'file-me.top', 'loot-link.com', 'lootdest.org'
  ];
  
  try {
    const urlObj = new URL(url);
    return validDomains.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

export function isValidImageUrl(url) {
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

// ─── GOG-Games.to helpers ───────────────────────────────────────────────────

const GOG_GAMES_BASE = 'https://gog-games.to';
const GOG_GAMES_IMAGE_BASE = 'https://images.gog-statics.com';
const ONLINE_FIX_BASE = 'https://online-fix.me';
const steamHeaderImageCache = new Map();

function decodeWindows1251(buffer, contentType = '') {
  const has1251 = /1251/i.test(contentType || '');
  if (has1251) {
    try {
      return new TextDecoder('windows-1251').decode(buffer);
    } catch {
      // Fallback to UTF-8 when legacy decoder is unavailable.
    }
  }
  return new TextDecoder('utf-8').decode(buffer);
}

function decodeBasicHtmlEntities(text = '') {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#038;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOnlineFixLink(link) {
  const normalized = link.startsWith('http') ? link : `${ONLINE_FIX_BASE}${link}`;
  const m = normalized.match(/\/(\d+)-([^/]+)\.html/i);
  return {
    link: normalized,
    id: m ? m[1] : null,
    slug: m ? m[2] : null
  };
}

function extractSearchTerms(query = '') {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(term => term.length > 0);
}

function slugMatchesQuery(slug = '', searchQuery = '') {
  const terms = extractSearchTerms(searchQuery);
  if (terms.length === 0) return true;
  const normalizedSlug = (slug || '').toLowerCase();
  return terms.some(term => normalizedSlug.includes(term));
}

function normalizeOnlineFixTitleForSteam(title = '') {
  return String(title)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^\)]*\)/g, ' ')
    .replace(/\b(online[-\s]?fix|ofme|build\s*\d+|v?\d+(?:\.\d+){0,4}|update|hotfix|repack)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseBestSteamSearchResult(results, query) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const normalizedQuery = query.toLowerCase().trim();

  let best = null;
  let bestScore = -1;

  for (const result of results.slice(0, 8)) {
    const name = String(result?.name || '').toLowerCase();
    if (!name) continue;

    let score = 0;
    if (name === normalizedQuery) score += 100;
    if (name.includes(normalizedQuery)) score += 40;
    if (normalizedQuery.includes(name)) score += 20;

    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
    const matchedTerms = queryTerms.filter(term => name.includes(term)).length;
    score += matchedTerms * 5;

    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }

  return best;
}

async function resolveSteamHeaderImageForOnlineFix(title = '') {
  const normalized = normalizeOnlineFixTitleForSteam(title);
  if (!normalized) return null;

  if (steamHeaderImageCache.has(normalized)) {
    return steamHeaderImageCache.get(normalized);
  }

  try {
    const response = await fetch(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(normalized)}`, {
      headers: { 'User-Agent': 'GameSearch-API-v2/2.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(4000)
    });

    if (!response.ok) {
      steamHeaderImageCache.set(normalized, null);
      return null;
    }

    const data = await response.json();
    const best = chooseBestSteamSearchResult(data, normalized);
    const appid = best?.appid ? String(best.appid) : '';
    const image = appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg` : null;
    steamHeaderImageCache.set(normalized, image);
    return image;
  } catch {
    steamHeaderImageCache.set(normalized, null);
    return null;
  }
}

function extractOnlineFixOfmeLink(rawHtml = '') {
  const decoded = rawHtml.replace(/<!\[CDATA\[|\]\]>/g, '');
  const hrefs = [...decoded.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(m => m[1]);

  for (const href of hrefs) {
    const normalized = decodeBasicHtmlEntities(href || '').trim();
    if (!normalized) continue;

    if (/ofme/i.test(normalized) || /\/engine\/go\.php\?url=/i.test(normalized)) {
      if (normalized.startsWith('http')) return normalized;
      if (normalized.startsWith('/')) return `${ONLINE_FIX_BASE}${normalized}`;
      return `${ONLINE_FIX_BASE}/${normalized}`;
    }
  }

  return null;
}

function buildOnlineFixPost({ id, title, link, date, image, description, excerpt, ofmeLink, downloadLinks }) {
  const parsed = parseOnlineFixLink(link);
  return {
    id: `onlinefix_${id || parsed.id || parsed.slug || Date.now()}`,
    originalId: id || parsed.id || '',
    title: decodeBasicHtmlEntities(title || 'No title').replace(/[\u0400-\u04FF]+/g, '').replace(/\s+/g, ' ').trim(),
    excerpt: decodeBasicHtmlEntities(excerpt || description || ''),
    link: parsed.link,
    date: date || null,
    slug: parsed.slug || '',
    description: decodeBasicHtmlEntities(description || excerpt || ''),
    categories: [],
    tags: [],
    downloadLinks: downloadLinks || (ofmeLink ? [{ type: 'hosting', service: 'OFME', url: ofmeLink, text: 'OFME' }] : []),
    source: 'Online-Fix',
    siteType: 'onlinefix',
    image: image || null,
    ofmeLink: ofmeLink || null
  };
}

/**
 * Fetch recently uploaded Online-Fix entries from RSS.
 */
export async function fetchOnlineFixRecent() {
  const response = await fetch(`${ONLINE_FIX_BASE}/rss.xml`, {
    headers: { 'User-Agent': 'GameSearch-API-v2/2.0', 'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8' }
  });
  if (!response.ok) {
    throw new Error(`Online-Fix RSS returned ${response.status}`);
  }

  const xml = decodeWindows1251(await response.arrayBuffer(), response.headers.get('content-type'));
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

  const posts = items.map(match => {
    const item = match[1] || '';
    const title = (item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    const descriptionRaw = (item.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const image = (descriptionRaw.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || null;
    const ofmeLink = extractOnlineFixOfmeLink(descriptionRaw);
    const description = stripHtml(descriptionRaw.replace(/<!\[CDATA\[|\]\]>/g, ''));
    const parsed = parseOnlineFixLink(link);

    return buildOnlineFixPost({
      id: parsed.id,
      title,
      link,
      date: pubDate ? new Date(pubDate).toISOString() : null,
      image,
      description,
      excerpt: description,
      ofmeLink
    });
  });

  await Promise.all(posts.map(async post => {
    if (!post.image) {
      post.image = await resolveSteamHeaderImageForOnlineFix(post.title);
    }
  }));

  return posts;
}

/**
 * Search Online-Fix HTML endpoint and extract matching game cards.
 */
export async function fetchOnlineFixSearch(searchQuery) {
  const url = `${ONLINE_FIX_BASE}/index.php?do=search&subaction=search&story=${encodeURIComponent(searchQuery)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GameSearch-API-v2/2.0', 'Accept': 'text/html,*/*;q=0.8' }
  });
  if (!response.ok) {
    throw new Error(`Online-Fix search returned ${response.status}`);
  }

  const html = decodeWindows1251(await response.arrayBuffer(), response.headers.get('content-type'));
  const cards = html.split(/<div class="news news-search">/i).slice(1);
  const seen = new Set();
  const results = [];

  for (const card of cards) {
    const link =
      (card.match(/<a class="img" href="(https?:\/\/online-fix\.me\/games\/[^"]+)"/i) || [])[1] ||
      (card.match(/<a class="big-link" href="(https?:\/\/online-fix\.me\/games\/[^"]+)"/i) || [])[1] ||
      '';
    if (!link) continue;
    if (seen.has(link)) continue;
    seen.add(link);

    const title = decodeBasicHtmlEntities(((card.match(/<h2 class="title">\s*([\s\S]*?)\s*<\/h2>/i) || [])[1] || '').replace(/<[^>]*>/g, ''));
    const datetime = (card.match(/<time[^>]+datetime="([^"]+)"/i) || [])[1] || null;
    const image =
      (card.match(/<img[^>]+data-src="([^"]+)"/i) || [])[1] ||
      (card.match(/<img[^>]+src="([^"]+)"/i) || [])[1] ||
      null;
    const previewRaw = (card.match(/<div class="preview-text">([\s\S]*?)<\/div>/i) || [])[1] || '';
    const preview = stripHtml(previewRaw);
    const ofmeLink = extractOnlineFixOfmeLink(card);
    const parsed = parseOnlineFixLink(link);

    if (!slugMatchesQuery(parsed.slug || '', searchQuery)) {
      continue;
    }

    results.push(buildOnlineFixPost({
      id: parsed.id,
      title: title || parsed.slug || 'No title',
      link,
      date: datetime,
      image,
      description: preview,
      excerpt: preview,
      ofmeLink
    }));
  }

  await Promise.all(results.map(async post => {
    if (!post.image) {
      post.image = await resolveSteamHeaderImageForOnlineFix(post.title);
    }
  }));

  return results;
}

/**
 * Fetch recent torrents from GOG-Games.to API
 */
export async function fetchGogGamesRecent() {
  const url = `${GOG_GAMES_BASE}/api/web/recent-torrents`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GameSearch-API-v2/2.0', 'Accept': 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`GOG-Games API returned ${response.status}`);
  }
  return response.json(); // returns array directly
}

/**
 * Transform a GOG-Games API item into the standard post format used by the rest of the API.
 * The `image` hash maps to: https://images.gog-statics.com/<hash>.jpg   (or _product_tile_256x.jpg via GOG CDN)
 * Torrent download link: https://gog-games.to/downloads/torrents/<torrent_filename>
 */
export function transformGogGamesPost(item) {
  const torrentUrl = item.torrent_filename
    ? `${GOG_GAMES_BASE}/downloads/torrents/${item.torrent_filename}`
    : null;

  // Build image URL from hash – GOG static images
  const image = item.image
    ? `${GOG_GAMES_IMAGE_BASE}/${item.image}.jpg`
    : null;

  // Use torrent_date (when torrent was added) as the post date, fall back to last_update
  const date = item.torrent_date || item.last_update || null;

  // Build a human-readable description from available metadata
  const descParts = [];
  if (item.developer) descParts.push(`Developer: ${item.developer}`);
  if (item.publisher) descParts.push(`Publisher: ${item.publisher}`);
  if (item.is_new) descParts.push('New release');
  if (item.is_updated) descParts.push('Updated');
  if (item.is_indev) descParts.push('In development');

  return {
    id: `goggames_${item.id}`,
    originalId: item.id,
    title: item.title || 'No title',
    excerpt: descParts.join(' · ') || '',
    link: `${GOG_GAMES_BASE}/game/${item.slug}`,
    date,
    slug: item.slug,
    description: descParts.join(' · ') || '',
    categories: [],
    tags: [],
    downloadLinks: torrentUrl ? [{ url: torrentUrl, label: 'Torrent', service: 'GOG-Games' }] : [],
    source: 'GOG-Games',
    siteType: 'goggames',
    image
  };
}
