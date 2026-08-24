/**
 * Game Search API v2 - Core Library
 * Shared logic for Vercel and Docker deployments
 */

// `./net` installs a minimal undici dispatcher that only raises TCP connect
// timeout. We intentionally avoid global headers/body timeouts so per-request
// AbortSignal.timeout in siteFetch() remains authoritative.

// Cache configuration
export const CACHE_CONFIG = {
  CACHE_TTL: 3600, // 1 hour
  STALE_WHILE_REVALIDATE: 7200, // 2 hours
  CACHE_PREFIX: 'game-search-v2:',
  RECENT_UPLOADS_KEY: 'recent-uploads-complete',
};

// Per-site HTTP timeout for `siteFetch()` (end-to-end `AbortSignal.timeout`).
// Defaults to 60s. This does not extend Node/undici's underlying TCP connect
// timeout; see note at top of file.
export const SITE_FETCH_TIMEOUT_MS = Math.max(
  10000,
  parseInt(process.env.SITE_FETCH_TIMEOUT_MS || '60000', 10) || 60000
);

// FlareSolverr timeout/retry settings (ms). FlareSolverr itself renders a
// browser to solve Cloudflare challenges, which can easily take >30s, so
// default to 60s and cap individual callers at 60s as well (they used to cap
// at 25s which guaranteed failures on cold solves).
export const DEFAULT_FLARE_TIMEOUT_MS = Math.max(
  10000,
  parseInt(process.env.FLARE_TIMEOUT_MS || '60000', 10) || 60000
);
export const DEFAULT_FLARE_RETRIES = Math.max(
  1,
  parseInt(process.env.FLARE_RETRIES || '2', 10) || 2
);

/**
 * Thin wrapper around fetch() that enforces `timeoutMs` as a hard end-to-end
 * ceiling via `AbortSignal.timeout`, composed with any caller `signal`.
 */
export function siteFetch(resource, options = {}, timeoutMs = SITE_FETCH_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const userSignal = options.signal;
  let signal = timeoutSignal;
  if (userSignal) {
    // AbortSignal.any is available on Node 20+; fall back to combining
    // listeners for older runtimes.
    if (typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([timeoutSignal, userSignal]);
    } else {
      const controller = new AbortController();
      const abort = (reason) => controller.abort(reason);
      if (userSignal.aborted) abort(userSignal.reason);
      else userSignal.addEventListener('abort', () => abort(userSignal.reason), { once: true });
      if (timeoutSignal.aborted) abort(timeoutSignal.reason);
      else timeoutSignal.addEventListener('abort', () => abort(timeoutSignal.reason), { once: true });
      signal = controller.signal;
    }
  }
  return fetch(resource, { ...options, signal });
}

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

let freegogCookie = {
  cf_clearance: null,
  cookies: [],
  userAgent: null,
  expires_at: 0
};

function hasFreshClearanceCookie(cookie) {
  return Boolean(
    cookie &&
    Array.isArray(cookie.cookies) &&
    cookie.cookies.length > 0 &&
    Date.now() < cookie.expires_at - 60_000
  );
}

function protectedSiteHeaders(userAgent, cookie, referer, origin) {
  const headers = {
    'User-Agent': cookie?.userAgent || userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  if (cookie?.cookies?.length) {
    headers.Cookie = cookie.cookies.join('; ');
    headers.Referer = referer;
    headers.Origin = origin;
  }

  return headers;
}

// Circuit breakers. Previously a single network hiccup would open the circuit
// for a long cooldown. With `siteFetch` end-to-end timeouts at 60s by default,
// we require two consecutive failures before opening and default the cooldown
// to 60s. Env overrides
// let operators retune without a code change.
const SKIDROW_COOLDOWN_MS = Math.max(10000, parseInt(process.env.SKIDROW_COOLDOWN_MS || '60000', 10) || 60000);
const SKIDROW_FAILURE_THRESHOLD = Math.max(1, parseInt(process.env.SKIDROW_FAILURE_THRESHOLD || '2', 10) || 2);
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
  if (skidrowCircuit.failures >= SKIDROW_FAILURE_THRESHOLD) {
    skidrowCircuit.cooldownUntil = Date.now() + SKIDROW_COOLDOWN_MS;
    console.warn(`Skidrow circuit opened for ${Math.round(SKIDROW_COOLDOWN_MS / 1000)}s after failure #${skidrowCircuit.failures}: ${skidrowCircuit.lastError}`);
  } else {
    console.warn(`Skidrow fetch failure #${skidrowCircuit.failures}/${SKIDROW_FAILURE_THRESHOLD} (circuit still closed): ${skidrowCircuit.lastError}`);
  }
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
const DODI_COOLDOWN_MS = Math.max(10000, parseInt(process.env.DODI_COOLDOWN_MS || '60000', 10) || 60000);
const DODI_FAILURE_THRESHOLD = Math.max(1, parseInt(process.env.DODI_FAILURE_THRESHOLD || '2', 10) || 2);
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
  if (dodiCircuit.failures >= DODI_FAILURE_THRESHOLD) {
    dodiCircuit.cooldownUntil = Date.now() + DODI_COOLDOWN_MS;
    console.warn(`DODI circuit opened for ${Math.round(DODI_COOLDOWN_MS / 1000)}s after failure #${dodiCircuit.failures}: ${dodiCircuit.lastError}`);
  } else {
    console.warn(`DODI fetch failure #${dodiCircuit.failures}/${DODI_FAILURE_THRESHOLD} (circuit still closed): ${dodiCircuit.lastError}`);
  }
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
  'steamrip': 40,
  'fitgirl': 40,
  'freegog': 40,
  'reloadedsteam': 40,
  'steamunderground': 40,
  'onlinefix': 40,
  'dodi': 40,
  'default': 50
};

// Site configurations
// Only the two sources being migrated to the Python backend remain. The rest
// (SteamRip, FreeGOG, ReloadedSteam, SteamUnderground, Online-Fix, DODI,
// FitGirl) are retired as the strangler migration proceeds — re-add an entry
// here once its scraper is ported and wired. Keep this aligned with
// src/lib/sites.ts (the UI's selectable site chips). csrin stays listed so
// getSiteDisplayName/getSiteConfig resolve it, but its recent uploads come from
// the Python backend, not fetchRecentFromSite (which returns [] for csrin).
export const SITE_CONFIGS = {
  'skidrow': {
    baseUrl: 'https://www.skidrowreloaded.com/wp-json/wp/v2/posts',
    type: 'skidrow',
    name: 'SkidrowReloaded'
  },
  'csrin': {
    baseUrl: 'https://cs.rin.ru/forum',
    type: 'csrin',
    name: 'CS.RIN.RU'
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
        session: 'steamrip',
        maxTimeout: timeoutMs,
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

    // Mirror the Skidrow/DODI behavior: if FlareSolverr didn't return a
    // cf_clearance cookie it usually means Cloudflare isn't actively
    // challenging the site right now. That's fine â€” we can still use the
    // User-Agent FlareSolverr saw working and whatever ancillary cookies it
    // captured. Previously we threw here, which left the image proxy with no
    // jar at all and made poster loads fail whenever CF wasn't challenging.
    if (!cf_clearance && allCookies.length > 0) {
      console.log('No cf_clearance cookie found for SteamRip, but using other cookies from FlareSolverr');
    } else if (!cf_clearance && allCookies.length === 0) {
      console.log('No cookies returned from FlareSolverr for SteamRip - Cloudflare protection is likely not active');
      cf_clearance = 'none';
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

    const cachedCookie = hasFreshClearanceCookie(steamripCookie) ? steamripCookie : null;

    // Reuse clearance on the first request. If no jar has been solved yet,
    // this remains an ordinary direct fetch with no FlareSolverr delay.
    let response = await siteFetch(url, {
      headers: protectedSiteHeaders(
        userAgent,
        cachedCookie,
        'https://steamrip.com/',
        'https://steamrip.com'
      )
    });

    let isCloudflare = hasCloudflareProtection(response);
    console.log(`Initial SteamRip fetch of ${url}: status=${response.status}, CF detected=${isCloudflare}, cached clearance=${Boolean(cachedCookie)}`);

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
      if (cachedCookie) steamripCookie.expires_at = 0;
      console.log('SteamRip clearance missing or rejected, falling back to FlareSolverr');
      const flareResponse = await fetchViaFlaresolverr(url, 'steamrip');
      if (flareResponse && flareResponse.ok) {
        return flareResponse;
      }

      if (isPageRequest) {
        console.warn('Failed to fetch SteamRip page (all methods exhausted)');
        return null;
      }
      throw new Error('SteamRip: all fetch methods failed (CF blocking)');
    }

    if (!response.ok) {
      if (isPageRequest) {
        console.warn(`Failed to fetch SteamRip page: ${response.status} ${response.statusText}`);
        return null;
      }
      throw new Error(`SteamRip API returned ${response.status}: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    console.error('Error fetching SteamRip:', error);
    if (isPageRequest) {
      return null;
    }
    throw error;
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
    const timeoutMs = DEFAULT_FLARE_TIMEOUT_MS;

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

// FlareSolverr cookie management for FreeGOGPCGames
export async function getFreshFreegogCookie() {
  console.log('Getting fresh cf_clearance cookie for FreeGOGPCGames');

  try {
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (!flaresolverrUrl) {
      throw new Error('FLARESOLVERR_URL environment variable is required for FreeGOGPCGames. Please set it to your FlareSolverr instance URL (e.g., http://localhost:8191/v1)');
    }

    const attempts = Math.max(1, parseInt(process.env.FLARE_RETRIES || '1', 10) || 1);
    const timeoutMs = DEFAULT_FLARE_TIMEOUT_MS;

    const response = await retryableFetch(flaresolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cmd: 'request.get',
        url: 'https://freegogpcgames.com/wp-json/wp/v2/posts',
        session: 'freegog',
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

    console.log(`FlareSolverr response for FreeGOG: status=${data.status}, cookies=${data.solution?.cookies?.length || 0}`);

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
    }

    if (!cf_clearance && allCookies.length === 0) {
      console.log('No cookies returned from FlareSolverr - Cloudflare protection likely not active for FreeGOG');
      cf_clearance = 'none';
    } else if (!cf_clearance) {
      console.log('No cf_clearance cookie found, but using other cookies from FlareSolverr');
    }

    const userAgent = data.solution.userAgent || 'GameSearch-API-v2/2.0';

    freegogCookie = {
      cf_clearance: cf_clearance,
      cookies: allCookies,
      userAgent: userAgent,
      expires_at: expires_at
    };

    return freegogCookie;
  } catch (error) {
    console.error('Error getting fresh FreeGOGPCGames cookie:', error);
    throw error;
  }
}

export async function getValidFreegogCookie() {
  if (!freegogCookie.cf_clearance || Date.now() >= freegogCookie.expires_at) {
    return await getFreshFreegogCookie();
  }
  return freegogCookie;
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
    const timeoutMs = DEFAULT_FLARE_TIMEOUT_MS;

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

/**
 * Ask FlareSolverr only for a reusable clearance jar.
 *
 * Callers fetch the protected resource themselves with the returned cookies
 * and exact browser User-Agent. Keeping this separate from
 * `fetchViaFlaresolverr` prevents poster bytes from making a browser round trip.
 */
export async function getFlaresolverrClearance(url, session = 'image-clearance') {
  const flaresolverrUrl = process.env.FLARESOLVERR_URL;
  if (!flaresolverrUrl) {
    throw new Error('FLARESOLVERR_URL is required to obtain Cloudflare clearance');
  }

  const timeoutMs = DEFAULT_FLARE_TIMEOUT_MS;
  const response = await retryableFetch(flaresolverrUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url,
      session,
      maxTimeout: timeoutMs,
    }),
  }, 1, timeoutMs + 5000);

  if (!response.ok) {
    throw new Error(`FlareSolverr clearance request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.status !== 'ok' || !data.solution) {
    throw new Error(`FlareSolverr clearance error: ${data.message || 'missing solution'}`);
  }

  const cookies = [];
  let cfClearance = null;
  let expiresAt = Date.now() + (4 * 60 * 60 * 1000);

  for (const cookie of Array.isArray(data.solution.cookies) ? data.solution.cookies : []) {
    if (!cookie?.name || typeof cookie.value !== 'string') continue;
    cookies.push(`${cookie.name}=${cookie.value}`);
    if (cookie.name === 'cf_clearance') {
      cfClearance = cookie.value;
      if (cookie.expires) {
        const numericExpiry = Number(cookie.expires);
        const parsedExpiry = Number.isFinite(numericExpiry)
          ? (numericExpiry > 1_000_000_000_000 ? numericExpiry : numericExpiry * 1000)
          : new Date(cookie.expires).getTime();
        if (Number.isFinite(parsedExpiry)) expiresAt = parsedExpiry;
      }
    }
  }

  if (cookies.length === 0) {
    const solutionStatus = Number(data.solution.status || 0);
    throw new Error(
      `FlareSolverr returned no clearance cookies${solutionStatus ? ` (status ${solutionStatus})` : ''}`,
    );
  }

  console.log(
    `Obtained image clearance for ${new URL(url).hostname}: cookies=${cookies.length}, cf_clearance=${Boolean(cfClearance)}`,
  );

  return {
    cf_clearance: cfClearance,
    cookies,
    userAgent: data.solution.userAgent || 'Mozilla/5.0',
    expires_at: expiresAt,
  };
}

// Fetch a URL via FlareSolverr and return the response body directly
export async function fetchViaFlaresolverr(url, session = 'default') {
  const flaresolverrUrl = process.env.FLARESOLVERR_URL;
  if (!flaresolverrUrl) return null;

  const timeoutMs = DEFAULT_FLARE_TIMEOUT_MS;

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
    if (data.status !== 'ok' || !data.solution?.response) {
      const msg = String(data?.message || '').toLowerCase();
      // FlareSolverr can return "No challenge detected" without a wrapped
      // `solution.response`. That's not actually a failure for us; fall back to
      // a normal direct fetch so search doesn't collapse to empty results.
      if (msg.includes('no challenge detected')) {
        console.log(`FlareSolverr reported no challenge for ${url}; using direct fetch fallback`);
        try {
          const direct = await siteFetch(url, {
            headers: {
              'User-Agent': 'GameSearch-API-v2/2.0',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          if (direct.ok) return direct;
        } catch (e) {
          console.warn(`Direct fallback after no-challenge failed for ${url}:`, e?.message || e);
        }
      }
      return null;
    }

    let body = data.solution.response;
    const status = data.solution.status || 200;

    // FlareSolverr wraps JSON API responses in HTML: <html>...<pre>[{...}]</pre></html>
    // Strip the HTML wrapper to get raw JSON
    const preMatch = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (preMatch) {
      body = preMatch[1];
    }

    const trimmed = body.trimStart();
    const contentType =
      preMatch || trimmed.startsWith('{') || trimmed.startsWith('[')
        ? 'application/json'
        : 'text/html';

    console.log(`FlareSolverr returned ${body.length} chars, status ${status} for ${url}`);

    // Update cookies from the solution while we're at it
    if (
      data.solution.cookies?.length &&
      (session === 'skidrowreloaded' ||
        session === 'steamrip' ||
        session === 'dodirepacks' ||
        session === 'dodirepacks-fallback' ||
        session === 'freegog')
    ) {
      const allCookies = data.solution.cookies.map(c => `${c.name}=${c.value}`);
      let cf = null;
      let exp = Date.now() + (4 * 60 * 60 * 1000);
      for (const c of data.solution.cookies) {
        if (c.name === 'cf_clearance') { cf = c.value; if (c.expires) exp = new Date(c.expires * 1000).getTime(); }
      }
      const jar = {
        cf_clearance: cf || 'none',
        cookies: allCookies,
        userAgent: data.solution.userAgent || null,
        expires_at: exp,
      };
      if (session === 'skidrowreloaded') {
        skidrowCookie = jar;
      } else if (session === 'steamrip') {
        steamripCookie = jar;
      } else if (session === 'freegog') {
        freegogCookie = jar;
      } else {
        dodiCookie = jar;
      }
    }

    return new Response(body, {
      status,
      headers: { 'Content-Type': contentType }
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

/**
 * SkidrowReloaded: WordPress REST (`/wp-json/...`) and HTML post pages.
 * Still uses FlareSolverr + cf_clearance when Cloudflare blocks — unchanged.
 * Poster images are loaded separately via `/api/proxy-image` + `imageCache.ts`
 * (plain HTTPS for skidrowreloaded.com media, no FlareSolverr).
 */
export async function fetchSkidrow(url, isPageRequest = false) {
  if (isSkidrowCircuitOpen()) {
    const remainingMs = skidrowCircuit.cooldownUntil - Date.now();
    console.warn(`Skidrow circuit open (${Math.max(0, Math.ceil(remainingMs / 1000))}s remaining)`);
    if (hasFreshClearanceCookie(skidrowCookie)) {
      try {
        const cookieResponse = await siteFetch(url, {
          headers: protectedSiteHeaders(
            'GameSearch-API-v2/2.0',
            skidrowCookie,
            'https://www.skidrowreloaded.com/',
            'https://www.skidrowreloaded.com'
          )
        });
        if (!hasCloudflareProtection(cookieResponse) && cookieResponse.ok) {
          resetSkidrowCircuit();
          return cookieResponse;
        }
        skidrowCookie.expires_at = 0;
      } catch (error) {
        console.warn('Skidrow cached-clearance fetch failed:', error?.message || error);
      }
    }
    console.log('Skidrow cached clearance unavailable or rejected, falling back to FlareSolverr');
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

    const cachedCookie = hasFreshClearanceCookie(skidrowCookie) ? skidrowCookie : null;

    // Attach cached clearance to the first request whenever possible.
    let response = await siteFetch(url, {
      headers: protectedSiteHeaders(
        userAgent,
        cachedCookie,
        'https://www.skidrowreloaded.com/',
        'https://www.skidrowreloaded.com'
      )
    });

    // Check for Cloudflare protection - even if status is 200!
    let isCloudflare = hasCloudflareProtection(response);
    console.log(`Initial fetch of ${url}: status=${response.status}, CF detected=${isCloudflare}, cached clearance=${Boolean(cachedCookie)}`);

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

    // Cloudflare protection detected after the cached-cookie/direct attempt.
    if (isCloudflare) {
      if (cachedCookie) skidrowCookie.expires_at = 0;
      console.log('Skidrow clearance missing or rejected, falling back to FlareSolverr');

      const flareResponse = await fetchViaFlaresolverr(url, 'skidrowreloaded');
      if (flareResponse && flareResponse.ok) {
        resetSkidrowCircuit();
        return flareResponse;
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

// DODI Repacks fetcher â€” CF-protected WordPress site, uses FlareSolverr
// Primary: dodi-repacks.download, Fallback: dodi-repacks.site

/**
 * FreeGOGPCGames fetcher - site recently started using Cloudflare protection.
 * Reuses cached clearance on the first request, then falls back to FlareSolverr.
 */
export async function fetchFreegog(url, isPageRequest = false) {
  try {
    const userAgent = isPageRequest ? 'GameSearch-API-v2-PageFetch/2.0' : 'GameSearch-API-v2/2.0';

    const cachedCookie = hasFreshClearanceCookie(freegogCookie) ? freegogCookie : null;

    let response = await siteFetch(url, {
      headers: protectedSiteHeaders(
        userAgent,
        cachedCookie,
        'https://freegogpcgames.com/',
        'https://freegogpcgames.com'
      )
    });

    let isCloudflare = hasCloudflareProtection(response);
    console.log(`Initial fetch of ${url}: status=${response.status}, CF detected=${isCloudflare}, cached clearance=${Boolean(cachedCookie)}`);

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
      if (cachedCookie) freegogCookie.expires_at = 0;
      console.log('FreeGOG clearance missing or rejected, falling back to FlareSolverr');

      // FlareSolverr refreshes the cached cookie as a side effect.
      const flareResponse = await fetchViaFlaresolverr(url, 'freegog');
      if (flareResponse && flareResponse.ok) {
        return flareResponse;
      }

      if (isPageRequest) {
        console.warn('Failed to fetch FreeGOG page (all methods exhausted)');
        return null;
      }
      throw new Error('FreeGOG: all fetch methods failed (CF blocking)');
    }

    if (isPageRequest) {
      console.warn(`Failed to fetch FreeGOG page: ${response.status} ${response.statusText}`);
      return null;
    }
    throw new Error(`FreeGOG API returned ${response.status}: ${response.statusText}`);
  } catch (error) {
    console.error('Error fetching FreeGOG:', error);
    if (isPageRequest) {
      return null;
    }
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function fetchDodi(url, isPageRequest = false) {
  if (isDodiCircuitOpen()) {
    const remainingMs = dodiCircuit.cooldownUntil - Date.now();
    console.warn(`DODI circuit open (${Math.max(0, Math.ceil(remainingMs / 1000))}s remaining)`);
    const fallbackUrl = url.replace('dodi-repacks.download', 'dodi-repacks.site');

    if (hasFreshClearanceCookie(dodiCookie)) {
      const cookieUrls = fallbackUrl === url ? [url] : [url, fallbackUrl];
      for (const cookieUrl of cookieUrls) {
        try {
          const cookieResponse = await siteFetch(cookieUrl, {
            headers: protectedSiteHeaders(
              'GameSearch-API-v2/2.0',
              dodiCookie,
              'https://dodi-repacks.site/',
              'https://dodi-repacks.site'
            )
          });
          if (!hasCloudflareProtection(cookieResponse) && cookieResponse.ok) {
            resetDodiCircuit();
            return cookieResponse;
          }
        } catch (error) {
          console.warn('DODI cached-clearance fetch failed:', error?.message || error);
        }
      }
      dodiCookie.expires_at = 0;
    }

    console.log('DODI cached clearance unavailable or rejected, falling back to FlareSolverr');
    const flareResponse = await fetchViaFlaresolverr(url, 'dodirepacks');
    if (flareResponse && flareResponse.ok) {
      resetDodiCircuit();
      return flareResponse;
    }
    // Try fallback domain
    if (fallbackUrl !== url) {
      console.log('Trying DODI fallback domain...');
      const fallbackResponse = await fetchViaFlaresolverr(fallbackUrl, 'dodirepacks-fallback');
      if (fallbackResponse && fallbackResponse.ok) {
        resetDodiCircuit();
        return fallbackResponse;
      }
    }
    return isPageRequest ? null : new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const userAgent = isPageRequest ? 'GameSearch-API-v2-PageFetch/2.0' : 'GameSearch-API-v2/2.0';

    const cachedCookie = hasFreshClearanceCookie(dodiCookie) ? dodiCookie : null;

    // Attach cached clearance to the first request whenever possible.
    let response = await siteFetch(url, {
      headers: protectedSiteHeaders(
        userAgent,
        cachedCookie,
        'https://dodi-repacks.site/',
        'https://dodi-repacks.site'
      )
    });

    let isCloudflare = hasCloudflareProtection(response);
    console.log(`Initial DODI fetch of ${url}: status=${response.status}, CF detected=${isCloudflare}, cached clearance=${Boolean(cachedCookie)}`);

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
      if (cachedCookie) dodiCookie.expires_at = 0;
      console.log('DODI clearance missing or rejected, falling back to FlareSolverr');

      const flareResponse = await fetchViaFlaresolverr(url, 'dodirepacks');
      if (flareResponse && flareResponse.ok) {
        // Store DODI cookies from FlareSolverr response
        resetDodiCircuit();
        return flareResponse;
      }

      // Try the alternate domain via FlareSolverr.
      const fallbackUrl = url.replace('dodi-repacks.download', 'dodi-repacks.site');
      if (fallbackUrl !== url) {
        console.log('Primary DODI domain failed, trying fallback domain via FlareSolverr...');
        const fallbackResponse = await fetchViaFlaresolverr(fallbackUrl, 'dodirepacks-fallback');
        if (fallbackResponse && fallbackResponse.ok) {
          resetDodiCircuit();
          return fallbackResponse;
        }
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
  // Skidrow / WordPress media: served as normal HTTPS now; browser loads via
  // /api/proxy-image with a same-site Referer when needed (see imageCache).
  let image = null;
  if (site.type === 'gamedrive') {
    image = pickFirstValidImage(
      post.featured_image_src,
      post.jetpack_featured_media_url,
      post.yoast_head_json?.og_image?.[0]?.url,
    );
  } else if (
    site.type === 'steamrip' ||
    site.type === 'reloadedsteam' ||
    site.type === 'steamunderground' ||
    site.type === 'skidrow'
  ) {
    image = pickFirstValidImage(
      post.featured_image_src,
      post.jetpack_featured_media_url,
      post.yoast_head_json?.og_image?.[0]?.url,
      post._embedded?.['wp:featuredmedia']?.[0]?.source_url,
      post._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes?.large?.source_url,
      post._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes?.medium_large?.source_url,
      post._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes?.full?.source_url,
    );
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
  // DODI: magnets/hosters live on the post page only — never scrape here.
  if (siteType === 'dodi') {
    return [];
  }

  try {
    let html;
    const downloadLinks = [];

    if (siteType === 'steamrip') {
      const response = await fetchSteamrip(postUrl, true);
      if (response && response.ok) {
        html = await response.text();
      } else if (wpContent) {
        console.warn(`SteamRip page fetch failed for ${postUrl}, using WP API content`);
        html = wpContent;
      } else {
        console.warn(`Failed to fetch post content from ${postUrl}`);
        return [];
      }

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
        response = await siteFetch(postUrl, {
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
      } else if (siteType === 'fitgirl') {
        // FitGirl posts contain hundreds of .partNN.rar links per filehoster
        // (e.g. ...part01.rar, ...part02.rar, ...). Enumerating each part
        // is hostile - the user would have to click 50+ buttons. Instead
        // FitGirl groups them: every section has a single paste.fitgirl-
        // repacks.site pastebin that holds the full ordered list for one
        // filehoster, and the anchor text is the filehoster name (e.g.
        // "Filehoster: DataNodes"). Surface only the pastebins; the part
        // files are silently dropped because they don't match the URL
        // pattern. Magnet links the post may include are emitted by the
        // torrent regex further down (shared with the gamedrive branch).
        const pasteRegex = /<a\s+[^>]*href=["'](https?:\/\/paste\.fitgirl-repacks\.site\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = pasteRegex.exec(html)) !== null) {
          const url = match[1];
          const text = stripHtml(decodeBasicHtmlEntities(match[2])).trim() || 'FitGirl Paste';
          if (downloadLinks.some(l => l.url === url)) continue;
          // Anchor text like ".torrent file only" identifies the torrent
          // pastebin (vs the per-filehoster ones). Tag it so the UI can
          // surface it as a torrent rather than a generic hosting link.
          const isTorrentPaste = /torrent/i.test(text);
          downloadLinks.push({
            type: isTorrentPaste ? 'torrent-file' : 'hosting',
            service: text,
            url,
            text,
            ...(isTorrentPaste ? { isTorrent: true } : {}),
          });
        }

        // FitGirl also posts a rutor.* tracker link as an alternative
        // torrent source (popular Russian tracker among FitGirl's audience).
        // Two flavors appear in the wild:
        //   - direct: ...rutor.info/.../whatever.torrent  → one-click .torrent
        //   - post:   rutor.info/torrent/<id>/<slug>      → page the user
        //             has to visit to grab the magnet/file from
        // Label them differently so the user knows what they're clicking,
        // but both keep isTorrent=true so any torrent UI affordances apply.
        // Permissive on TLD because rutor mirrors across .info / .org / etc.
        const rutorRegex = /<a\s+[^>]*href=["'](https?:\/\/(?:[\w-]+\.)?rutor\.[a-z]{2,}\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        while ((match = rutorRegex.exec(html)) !== null) {
          const url = match[1];
          if (downloadLinks.some(l => l.url === url)) continue;
          const isDirectTorrent = /\.torrent(?:$|\?)/i.test(url);
          const label = isDirectTorrent ? 'Torrent' : 'RuTor (post)';
          downloadLinks.push({
            type: 'torrent-file',
            service: label,
            url,
            text: label,
            isTorrent: true,
          });
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
          if (isExcludedReloadedSteamUtilityFile(url)) continue;

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
        // DODI Repacks â€” magnet links and file hosting (similar structure to reloadedsteam)
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
  const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    const image = decodeBasicHtmlEntities(match[1] || '').trim();
    if (isValidImageUrl(image)) return image;
  }
  return null;
}

function pickFirstValidImage(...candidates) {
  for (const candidate of candidates) {
    const image = typeof candidate === 'string' ? decodeBasicHtmlEntities(candidate).trim() : '';
    if (isValidImageUrl(image)) return image;
  }
  return null;
}

function extractDescription(content) {
  if (!content) return '';
  const stripped = stripHtml(content);
  return stripped.length > 300 ? stripped.substring(0, 300) + '...' : stripped;
}

/**
 * ReloadedSteam posts often list VC++/DirectX redist archives as separate hoster
 * buttons (e.g. datanodes.to/.../_CommonRedist.rar) — not the game itself.
 */
function isExcludedReloadedSteamUtilityFile(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const filename = path.split('/').pop() || path;
    const lower = filename.toLowerCase();
    if (lower.includes('commonredist')) return true;
    if (/^_redist(\.|$)/i.test(filename)) return true;
    return false;
  } catch {
    return false;
  }
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
    'file-me.top', 'loot-link.com', 'lootdest.org',
    // Common on SteamRip / scene repacks
    'workupload.com', 'send.cm', 'send.now', 'megadb.net', 'qiwi.gg',
    'upload.ee', 'uploadnow.io', 'fuckingfast.net'
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
  if (!text) return text;
  // Decode &amp; BEFORE numeric entities so that double-encoded sequences like
  // `&amp;#8211;` (an en-dash that survived two rounds of WordPress escaping)
  // get fully unwrapped. Without this, only the outer `&amp;` would be
  // decoded and `&#8211;` would leak through into cleaned titles as literal
  // "8211", breaking similarity matching for games like
  // "Avatar: Frontiers of Pandora â€“ Gold Edition".
  const pass = (s) =>
    s
      .replace(/&amp;/gi, '&')
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
        const code = parseInt(h, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&nbsp;/gi, ' ');

  // Loop until stable (caps at 3 passes) to handle rare multi-encoded input.
  let prev = text;
  for (let i = 0; i < 3; i++) {
    const next = pass(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev.replace(/\s+/g, ' ').trim();
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
    // Use shared.fastly.steamstatic.com (the current canonical Steam store
    // asset CDN) â€” the older `cdn.cloudflare.steamstatic.com/steam/apps/...`
    // path regularly 404s for newer appids.
    const image = appid ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg` : null;
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
  const response = await siteFetch(`${ONLINE_FIX_BASE}/rss.xml`, {
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
  const response = await siteFetch(url, {
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

// ── cs.rin.ru forum integration ──────────────────────────────────────────────
// cs.rin.ru is a phpBB forum that requires login to search/view threads.
// We log in once per server lifetime with a dedicated bot account
// (CSRIN_USERNAME / CSRIN_PASSWORD env vars), cache the session cookies in
// memory, and re-login on expiry or session loss. We DO NOT scrape download
// links from threads - search results return the thread URL and the user
// clicks through to the forum themselves.

const CSRIN_BASE = 'https://cs.rin.ru/forum';
const CSRIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CSRIN_SESSION_TTL = 60 * 60 * 1000; // 1 hour - phpBB sessions usually last longer but be conservative
const CSRIN_LOGIN_FAIL_COOLDOWN = 5 * 60 * 1000; // 5 minutes - don't hammer on bad creds

const csrinSession = {
  cookies: '',          // serialised "name=value; name=value" Cookie header
  loggedInAt: 0,        // ms timestamp of last successful login
  loginFailedAt: 0,     // ms timestamp of last failed login attempt
  loggingIn: null,      // in-flight login promise (de-dupes concurrent callers)
};

// Extract Set-Cookie values from a Response, returning ["name=value", ...].
// Strips attributes (Path, Domain, HttpOnly, etc) - we just want the pair.
function parseSetCookies(response) {
  const getter = response.headers.getSetCookie?.bind(response.headers);
  if (typeof getter === 'function') {
    return getter().map(c => c.split(';')[0].trim()).filter(Boolean);
  }
  // Fallback for older runtimes - single combined header (lossy if multiple)
  const single = response.headers.get('set-cookie');
  if (!single) return [];
  return single.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0].trim()).filter(Boolean);
}

// Merge a "name=value; name=value" string with an array of new "name=value"
// pairs - later writes win, matching browser cookie jar semantics.
function mergeCookieString(existing, additions) {
  const map = new Map();
  if (existing) {
    for (const pair of existing.split(';')) {
      const trimmed = pair.trim();
      const eq = trimmed.indexOf('=');
      if (eq > 0) map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  for (const pair of additions) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Decode the small set of HTML entities phpBB emits in thread titles.
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function performCsrinLogin() {
  const username = process.env.CSRIN_USERNAME;
  const password = process.env.CSRIN_PASSWORD;
  if (!username || !password) {
    // Not configured - silently skip
    return false;
  }

  try {
    // 1) GET the login form. csrinFetch transparently solves the security-
    //    check challenge if cs.rin.ru fires it (it always does on a cold
    //    session). It also accumulates session cookies into csrinSession.cookies
    //    as a side effect, so we don't need to track initialCookies separately.
    const formResp = await csrinFetch(`${CSRIN_BASE}/ucp.php?mode=login`);
    if (!formResp || !formResp.ok) {
      console.warn(`cs.rin.ru login form fetch failed: ${formResp?.status || 'no response'}`);
      return false;
    }
    const formHtml = await formResp.text();

    const params = new URLSearchParams();
    params.set('username', username);
    params.set('password', password);
    params.set('redirect', 'index.php');
    params.set('login', 'Login');
    const sidMatch = formHtml.match(/name="sid"\s+value="([^"]+)"/);
    if (sidMatch) params.set('sid', sidMatch[1]);
    const formTokenMatch = formHtml.match(/name="form_token"\s+value="([^"]+)"/);
    if (formTokenMatch) params.set('form_token', formTokenMatch[1]);
    const creationTimeMatch = formHtml.match(/name="creation_time"\s+value="([^"]+)"/);
    if (creationTimeMatch) params.set('creation_time', creationTimeMatch[1]);

    // 2) POST credentials. Use redirect:'manual' so we can read the Set-Cookie
    //    on the redirect response before the browser would follow it.
    //    csrinFetch carries the security-check + initial session cookies for
    //    us via csrinSession.cookies.
    const loginResp = await csrinFetch(`${CSRIN_BASE}/ucp.php?mode=login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${CSRIN_BASE}/ucp.php?mode=login`,
      },
      body: params.toString(),
      redirect: 'manual',
    });

    const loginCookies = parseSetCookies(loginResp);
    csrinSession.cookies = mergeCookieString(csrinSession.cookies, loginCookies);
    const merged = csrinSession.cookies;

    // phpBB sets a `<prefix>phpbb3_u` cookie containing the user id. "1" is
    // the anonymous guest. Anything else means we're logged in. The middle
    // segment between phpbb3_ and _u is the board id and is sometimes empty
    // (cs.rin.ru uses `csrinru_phpbb3_u`), so allow zero-or-more chars there.
    // A 3xx redirect back to index.php is also a strong success signal but
    // some installs return 200 with a "logged in successfully" interstitial
    // instead, so we treat the cookie as authoritative.
    const userIdMatch = merged.match(/phpbb3\w*_u=(\d+)/i);
    const isAnonymous = !userIdMatch || userIdMatch[1] === '1';
    const isRedirect = loginResp.status >= 300 && loginResp.status < 400;

    if (isAnonymous && !isRedirect) {
      console.warn(`cs.rin.ru login appears rejected (status ${loginResp.status}, user id ${userIdMatch?.[1] || 'none'})`);
      return false;
    }

    csrinSession.loggedInAt = Date.now();
    csrinSession.loginFailedAt = 0;
    console.log('cs.rin.ru login successful');
    return true;
  } catch (err) {
    console.warn('cs.rin.ru login error:', err?.message || err);
    return false;
  }
}

// Ensure we have a fresh session. Coalesces concurrent calls so we don't
// hit /ucp.php?mode=login multiple times in parallel.
async function ensureCsrinSession() {
  const sessionFresh = csrinSession.cookies && (Date.now() - csrinSession.loggedInAt < CSRIN_SESSION_TTL);
  if (sessionFresh) return true;

  if (csrinSession.loginFailedAt && Date.now() - csrinSession.loginFailedAt < CSRIN_LOGIN_FAIL_COOLDOWN) {
    return false;
  }

  if (csrinSession.loggingIn) {
    return await csrinSession.loggingIn;
  }
  csrinSession.loggingIn = (async () => {
    const ok = await performCsrinLogin();
    if (!ok) csrinSession.loginFailedAt = Date.now();
    csrinSession.loggingIn = null;
    return ok;
  })();
  return await csrinSession.loggingIn;
}

// Detect the "you must log in" interstitial phpBB shows when the session is
// gone. Cheap and tolerant - we just look for the login form action.
function looksLikeLoginPage(html) {
  if (!html) return false;
  return /name="username"/i.test(html) && /name="password"/i.test(html) && /mode=login/i.test(html);
}

// cs.rin.ru gates every request behind a JS-driven anti-bot challenge: the
// server returns 401 with HTML that sets two cookies (securitytoken +
// securitytoken_expiration) via JS, then redirects the browser to
// /securitycheck<path> which validates the cookies and issues a session
// cookie. We replicate this in plain HTTP - no JS engine needed since the
// tokens are right in the response body.
function looksLikeCsrinSecurityCheck(html) {
  if (!html) return false;
  return html.includes('CS RIN - Security check') || /securitytoken=[\w-]+/.test(html);
}

async function solveCsrinSecurityCheck(originalUrl, html) {
  const tokenMatch = html.match(/securitytoken=([\w-]+)/);
  const expirationMatch = html.match(/securitytoken_expiration=(\d+)/);
  if (!tokenMatch || !expirationMatch) {
    console.warn('cs.rin.ru: 401 received but security tokens not parseable');
    return false;
  }

  // Plant the tokens in our cookie jar before hitting the validator.
  csrinSession.cookies = mergeCookieString(csrinSession.cookies, [
    `securitytoken=${tokenMatch[1]}`,
    `securitytoken_expiration=${expirationMatch[1]}`,
  ]);

  // The JS does: newURL = url.replace(pathname, "/securitycheck" + pathname).
  // Translation in plain JS:
  const urlObj = new URL(originalUrl);
  const checkUrl = `${urlObj.origin}/securitycheck${urlObj.pathname}${urlObj.search}`;

  const checkResp = await siteFetch(checkUrl, {
    headers: {
      'User-Agent': CSRIN_USER_AGENT,
      'Cookie': csrinSession.cookies,
      'Referer': originalUrl,
    },
    redirect: 'manual',
  });
  const newCookies = parseSetCookies(checkResp);
  if (newCookies.length) {
    csrinSession.cookies = mergeCookieString(csrinSession.cookies, newCookies);
  }
  return true;
}

// Wrapper around siteFetch that:
//   - sticks our cs.rin.ru cookie jar onto every request
//   - transparently solves the security-check challenge and retries once
//     when the server fires it
async function csrinFetch(url, options = {}) {
  const buildHeaders = () => ({
    'User-Agent': CSRIN_USER_AGENT,
    ...(options.headers || {}),
    Cookie: csrinSession.cookies,
  });

  let response = await siteFetch(url, { ...options, headers: buildHeaders() });

  if (response.status === 401) {
    // Consume the body so we can inspect it without leaving the stream half-read.
    const body = await response.text();
    if (looksLikeCsrinSecurityCheck(body)) {
      console.log('cs.rin.ru: solving security check');
      const solved = await solveCsrinSecurityCheck(url, body);
      if (solved) {
        response = await siteFetch(url, { ...options, headers: buildHeaders() });
      } else {
        // Reconstruct so the caller sees the original failure body.
        response = new Response(body, {
          status: 401,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } else {
      response = new Response(body, {
        status: 401,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  }

  return response;
}

function buildCsrinPost({ threadId, title, link }) {
  return {
    id: `csrin-${threadId}`,
    originalId: threadId,
    title,
    excerpt: '',
    link,
    date: new Date().toISOString(),
    slug: '',
    description: 'Forum thread on cs.rin.ru - click to view the latest post',
    categories: [],
    tags: [],
    downloadLinks: [],
    source: 'CS.RIN.RU',
    siteType: 'csrin',
    image: null,
  };
}

function parseCsrinSearchResults(html) {
  // First pass: scan every viewtopic href that carries `start=N` and record
  // the largest start per thread. phpBB puts these inside the
  // "Go to page: 1 ... 27, 28, 29" pagination span next to each result -
  // the topictitle anchor itself never has `start=`, so we couldn't find
  // the latest page from that link alone. Highest start = latest page,
  // which is where users want to land for "what changed recently in this
  // thread". Also remembers the `f=` (forum id) seen alongside.
  const lastStartByThread = new Map();
  const lastForumByThread = new Map();
  const startHrefRe = /href="([^"]*viewtopic\.php\?[^"]*start=\d+[^"]*)"/gi;
  for (const m of html.matchAll(startHrefRe)) {
    const href = decodeEntities(m[1]);
    const t = href.match(/[?&]t=(\d+)/)?.[1];
    const sStr = href.match(/[?&]start=(\d+)/)?.[1];
    const f = href.match(/[?&]f=(\d+)/)?.[1];
    if (!t || sStr === undefined) continue;
    const s = parseInt(sStr, 10);
    if (!Number.isFinite(s)) continue;
    const prev = lastStartByThread.get(t);
    if (prev === undefined || s > prev) {
      lastStartByThread.set(t, s);
      if (f) lastForumByThread.set(t, f);
    }
  }

  const results = [];
  const seen = new Set();

  // Second pass: every <a class="topictitle"> anchor is a search hit. Title
  // comes from the anchor text, the latest-page URL comes from the lookup
  // tables above (falling back to the anchor's own href values when the
  // thread fits on a single page - no pagination = no start= anchors).
  const patterns = [
    /<a\s+[^>]*class="topictitle"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a\s+[^>]*href="([^"]+)"[^>]*class="topictitle"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const href = decodeEntities(m[1]);
      const titleHtml = m[2];
      const threadId = href.match(/[?&]t=(\d+)/)?.[1];
      if (!threadId) continue;
      if (seen.has(threadId)) continue;
      seen.add(threadId);

      // Strip elements that are visually hidden (display:none /
      // visibility:hidden). phpBB themes on cs.rin.ru use these for
      // screen-reader status labels like "SCS - offline" sitting next to
      // a status-indicator image - they'd leak into the visible title.
      const title = decodeEntities(
        titleHtml
          .replace(/<([a-z]+)[^>]*style="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '')
          .replace(/<[^>]+>/g, '')
      ).replace(/\s+/g, ' ').trim();
      if (!title) continue;

      const linkParams = new URLSearchParams();
      const f = lastForumByThread.get(threadId) || href.match(/[?&]f=(\d+)/)?.[1];
      if (f) linkParams.set('f', f);
      linkParams.set('t', threadId);
      const lastStart = lastStartByThread.get(threadId);
      if (lastStart !== undefined) linkParams.set('start', String(lastStart));
      const link = `${CSRIN_BASE}/viewtopic.php?${linkParams.toString()}`;
      results.push(buildCsrinPost({ threadId, title, link }));
    }
  }

  return results;
}

export async function fetchCsrinSearch(searchQuery) {
  const ready = await ensureCsrinSession();
  if (!ready) return [];

  // Param set mirrors what the browser sends when you submit the search form.
  // Several of these (sc, st, ch, t, submit) are no-ops on most phpBB installs
  // but matching the browser request exactly avoids surprises if cs.rin.ru
  // ever validates them.
  const params = new URLSearchParams({
    keywords: searchQuery,
    terms: 'all',     // all keywords must match
    author: '',       // any author
    sc: '1',          // search children of subforums too
    sf: 'titleonly',  // titles only - faster, less noise
    sk: 't',          // sort by topic creation date
    sd: 'd',          // descending
    sr: 'topics',     // return topics, not individual posts
    st: '0',          // any time (no date cutoff)
    ch: '300',        // excerpt character count
    t: '0',
    submit: 'Search',
  });

  const doFetch = () => csrinFetch(`${CSRIN_BASE}/search.php?${params}`, {
    headers: { 'Referer': `${CSRIN_BASE}/index.php` },
  });

  try {
    let response = await doFetch();
    if (!response || !response.ok) {
      console.warn(`cs.rin.ru search returned ${response?.status || 'no response'}`);
      return [];
    }
    let html = await response.text();

    // If we got bounced to the login page, our session died - re-login once
    // and retry. If it still fails, give up for this request.
    if (looksLikeLoginPage(html)) {
      console.log('cs.rin.ru session expired mid-search, re-logging in');
      csrinSession.cookies = '';
      csrinSession.loggedInAt = 0;
      const reAuth = await ensureCsrinSession();
      if (!reAuth) return [];
      response = await doFetch();
      if (!response || !response.ok) return [];
      html = await response.text();
      if (looksLikeLoginPage(html)) return [];
    }

    return parseCsrinSearchResults(html);
  } catch (err) {
    console.error('cs.rin.ru search error:', err?.message || err);
    return [];
  }
}

// Latest topics from the Game/Application Releases subforum (f=10), shown
// when the user explicitly clicks the cs.rin.ru chip on the home page.
// Cached in-memory with a 15-minute TTL so repeated chip clicks don't
// hammer the forum.
const CSRIN_RECENT_FORUM_ID = '10';
const CSRIN_RECENT_TTL_MS = 15 * 60 * 1000;
const csrinRecentCache = { results: [], timestamp: 0 };

export async function fetchCsrinRecent() {
  if (
    csrinRecentCache.timestamp > 0 &&
    Date.now() - csrinRecentCache.timestamp < CSRIN_RECENT_TTL_MS
  ) {
    return csrinRecentCache.results;
  }

  const ready = await ensureCsrinSession();
  if (!ready) return csrinRecentCache.results;

  const viewforumUrl = `${CSRIN_BASE}/viewforum.php?f=${CSRIN_RECENT_FORUM_ID}`;
  const doFetch = () => csrinFetch(viewforumUrl, {
    headers: { 'Referer': `${CSRIN_BASE}/index.php` },
  });

  try {
    let response = await doFetch();
    if (!response || !response.ok) {
      console.warn(`cs.rin.ru viewforum returned ${response?.status || 'no response'}`);
      return csrinRecentCache.results;
    }
    let html = await response.text();

    // Same session-expired retry as search: if we land on the login page,
    // re-login once and retry the request.
    if (looksLikeLoginPage(html)) {
      console.log('cs.rin.ru session expired mid-recent, re-logging in');
      csrinSession.cookies = '';
      csrinSession.loggedInAt = 0;
      const reAuth = await ensureCsrinSession();
      if (!reAuth) return csrinRecentCache.results;
      response = await doFetch();
      if (!response || !response.ok) return csrinRecentCache.results;
      html = await response.text();
      if (looksLikeLoginPage(html)) return csrinRecentCache.results;
    }

    // The viewforum.php HTML uses the same topictitle anchor + pagination
    // span markup as search results, BUT it groups announcements + stickies
    // (forum rules, privacy policy, etc.) above the actual topic list under
    // a "Topics" section header. Slice from that header so we don't return
    // pinned meta-threads as if they were game releases.
    const topicsHeaderIdx = html.indexOf('>Topics</b>');
    const sliceFrom = topicsHeaderIdx >= 0 ? topicsHeaderIdx : 0;
    // Cap at 20 - first page of viewforum.php returns ~50-100 threads but
    // users only need a glance at what's new. Keeps the payload tiny and
    // matches the "recent uploads" framing.
    const results = parseCsrinSearchResults(html.slice(sliceFrom)).slice(0, 20);
    if (results.length > 0) {
      csrinRecentCache.results = results;
      csrinRecentCache.timestamp = Date.now();
    }
    return results;
  } catch (err) {
    console.error('cs.rin.ru recent error:', err?.message || err);
    return csrinRecentCache.results;
  }
}

