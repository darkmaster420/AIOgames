/**
 * SteamDB API integration for monitoring game updates
 * Uses SteamDB's patch notes RSS API for Steam-verified games
 */

export interface SteamDBUpdate {
  appId: string;
  gameTitle: string;
  version?: string;
  changeNumber?: string;
  date: string;
  description: string;
  link: string;
}

export interface SteamDBResponse {
  updates: SteamDBUpdate[];
  lastChecked: string;
}

// In-memory cache and rate limiting for SteamDB requests
const STEAMDB_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_FETCH_INTERVAL_MS = 2000; // global min interval between upstream requests

const steamdbCache = new Map<string, { timestamp: number; updates: SteamDBUpdate[] }>();
const pendingFetches = new Map<string, Promise<SteamDBUpdate[]>>();
let lastFetchAt = 0;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureGlobalRateLimit() {
  const now = Date.now();
  const elapsed = now - lastFetchAt;
  if (elapsed < MIN_FETCH_INTERVAL_MS) {
    await sleep(MIN_FETCH_INTERVAL_MS - elapsed);
  }
  lastFetchAt = Date.now();
}

/**
 * Fetch patch notes for a specific Steam app from SteamDB
 */
export async function fetchSteamDBUpdates(appId: string): Promise<SteamDBUpdate[]> {
  try {
    // Serve from cache if fresh
    const cached = steamdbCache.get(appId);
    if (cached && Date.now() - cached.timestamp < STEAMDB_CACHE_TTL_MS) {
      return cached.updates;
    }

    // De-duplicate concurrent requests for the same appId
    const inFlight = pendingFetches.get(appId);
    if (inFlight) {
      return inFlight;
    }

    // Create fetch promise and store as pending
    const fetchPromise = (async () => {
      await ensureGlobalRateLimit();

      const url = `https://steamdb.info/api/PatchnotesRSS/?appid=${appId}`;

      // Abortable fetch with timeout to avoid hanging dev server
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            'User-Agent': 'AIOGames/1.2.1 (Game Update Tracker)'
          },
          signal: controller.signal
        });
      } catch (err) {
        // Fetch failed (timeout/network)
        clearTimeout(timeout);
        if (cached) return cached.updates;
        throw new Error(`SteamDB fetch failed for ${appId}: ${String(err)}`);
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        // On failure, return stale cache if available
        if (cached) return cached.updates;
        
        // 404 means no patch notes available for this app - not an error, just return empty
        if (response.status === 404) {
          console.log(`No SteamDB patch notes found for app ${appId} (404 - expected for some games)`);
          const emptyResult: SteamDBUpdate[] = [];
          // Cache the empty result so we don't keep hitting SteamDB
          steamdbCache.set(appId, { timestamp: Date.now(), updates: emptyResult });
          return emptyResult;
        }
        
        // For other errors, log but return empty instead of throwing
        console.warn(`SteamDB API error for app ${appId}: ${response.status}`);
        return [];
      }

      const rssText = await response.text().catch(() => '');
      if (!rssText) {
        if (cached) return cached.updates;
        return [];
      }

      const updates = parseSteamDBRSS(rssText, appId);
      steamdbCache.set(appId, { timestamp: Date.now(), updates });
      return updates;
    })().finally(() => {
      pendingFetches.delete(appId);
    });

    pendingFetches.set(appId, fetchPromise);
    return await fetchPromise;
  } catch (error) {
    console.error(`Error fetching SteamDB updates for app ${appId}:`, error);
    // On error, return stale cache if available
    const cached = steamdbCache.get(appId);
    if (cached) return cached.updates;
    return [];
  }
}

/**
 * Parse SteamDB RSS feed
 */
function parseSteamDBRSS(rssText: string, appId: string): SteamDBUpdate[] {
  const updates: SteamDBUpdate[] = [];
  
  try {
    // Validate RSS text is not empty
    if (!rssText || typeof rssText !== 'string') {
      console.warn(`Empty or invalid RSS text for appId ${appId}`);
      return [];
    }

    // Simple XML parsing for RSS items
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items = rssText.match(itemRegex) || [];

    if (items.length === 0) {
      console.warn(`No RSS items found for appId ${appId}`);
    }

    for (const item of items) {
      try {
        const title = extractXMLContent(item, 'title');
        const link = extractXMLContent(item, 'link');
        const pubDate = extractXMLContent(item, 'pubDate');
        const description = extractXMLContent(item, 'description');
        const guid = extractXMLContent(item, 'guid');

        // Skip items without required fields
        if (!title || !link || !pubDate) {
          console.warn(`Skipping RSS item with missing required fields (appId: ${appId})`);
          continue;
        }

        // Extract game name from title (e.g., "Risk of Rain 2 update for 3 October 2025")
        const gameNameMatch = title.match(/^(.+?)\s+update\s+for/i);
        const gameTitle = gameNameMatch ? gameNameMatch[1] : title;

        // Extract build number from guid (e.g., "build#20196450")
        const buildMatch = guid ? guid.match(/build#(\d+)/) : null;
        const buildNumber = buildMatch ? buildMatch[1] : undefined;

        // Extract version from description if available (e.g., "V1.3.9")
        const versionMatch = description ? description.match(/V?(\d+\.\d+(?:\.\d+)?)/i) : null;
        const version = versionMatch ? versionMatch[1] : undefined;

        // Safely parse pubDate with fallback
        let isoDate: Date;
        try {
          isoDate = new Date(pubDate);
          if (isNaN(isoDate.getTime())) {
            console.warn(`Invalid pubDate "${pubDate}" for appId ${appId}, using current time`);
            isoDate = new Date();
          }
        } catch {
          console.warn(`Failed to parse pubDate "${pubDate}" for appId ${appId}, using current time`);
          isoDate = new Date();
        }

        updates.push({
          appId,
          gameTitle,
          version,
          changeNumber: buildNumber,
          date: isoDate.toISOString(),
          description: description || title,
          link,
        });
      } catch (error) {
        console.error(`Error parsing RSS item for appId ${appId}:`, error);
        // Continue processing other items even if one fails
        continue;
      }
    }
  } catch (error) {
    console.error(`Fatal error parsing RSS feed for appId ${appId}:`, error);
    return [];
  }

  return updates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Extract content from XML tags with improved error handling
 */
function extractXMLContent(xml: string, tag: string): string {
  try {
    if (!xml || !tag) return '';
    
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, '');
    const match = xml.match(regex);
    
    if (!match || !match[1]) return '';
    
    // Remove CDATA markers and trim
    const content = match[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return content;
  } catch (error) {
    console.error(`Error extracting XML content for tag "${tag}":`, error);
    return '';
  }
}

/**
 * Check for updates for multiple Steam-verified games
 */
export async function checkSteamVerifiedGamesForUpdates(steamApps: Array<{ appId: string; gameTitle: string; lastChecked?: string }>): Promise<SteamDBResponse> {
  const allUpdates: SteamDBUpdate[] = [];
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - 24); // Only check last 24 hours

  for (const app of steamApps) {
    try {
      const updates = await fetchSteamDBUpdates(app.appId);
      
      // Filter to only recent updates
      const recentUpdates = updates.filter(update => {
        const updateDate = new Date(update.date);
        return updateDate > cutoffDate;
      });

      allUpdates.push(...recentUpdates);
      
      // Add delay between requests to be respectful
      if (steamApps.indexOf(app) < steamApps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Failed to check updates for ${app.gameTitle} (${app.appId}):`, error);
    }
  }

  return {
    updates: allUpdates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    lastChecked: new Date().toISOString(),
  };
}

/**
 * Format SteamDB update for display
 */
export function formatSteamDBUpdate(update: SteamDBUpdate): string {
  const parts = [];
  
  if (update.version) {
    parts.push(`Version ${update.version}`);
  }
  
  if (update.changeNumber) {
    parts.push(`Build ${update.changeNumber}`);
  }
  
  const timeAgo = getTimeAgo(update.date);
  parts.push(`${timeAgo} ago`);
  
  return parts.join(' • ');
}

/**
 * Format SteamDB update for game card display
 */
export function formatSteamDBUpdateForCard(update: SteamDBUpdate): string {
  let updateText = 'New Update Detected: ';
  
  // Extract the update title from description or use a generic title
  if (update.description && update.description.includes('Update Notes')) {
    // Extract from description like "Memory Optimization Update Notes V1.3.9"
    const titleMatch = update.description.match(/^(.+?)\s+Notes/);
    if (titleMatch) {
      updateText += titleMatch[1];
    } else {
      updateText += 'Latest Update';
    }
  } else {
    updateText += 'Latest Update';
  }
  
  // Add version or build info
  if (update.version) {
    updateText += ` V${update.version}`;
  } else if (update.changeNumber) {
    updateText += ` Build ${update.changeNumber}`;
  }
  
  return updateText;
}

/**
 * Get time ago string
 */
function getTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'just now';
}