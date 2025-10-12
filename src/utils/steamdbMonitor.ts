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

/**
 * Fetch patch notes for a specific Steam app from SteamDB
 */
export async function fetchSteamDBUpdates(appId: string): Promise<SteamDBUpdate[]> {
  try {
    const url = `https://steamdb.info/api/PatchnotesRSS/?appid=${appId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AIOGames/1.1.1 (Game Update Tracker)',
      },
    });

    if (!response.ok) {
      throw new Error(`SteamDB API error: ${response.status}`);
    }

    const rssText = await response.text();
    return parseSteamDBRSS(rssText, appId);
  } catch (error) {
    console.error(`Error fetching SteamDB updates for app ${appId}:`, error);
    return [];
  }
}

/**
 * Parse SteamDB RSS feed
 */
function parseSteamDBRSS(rssText: string, appId: string): SteamDBUpdate[] {
  const updates: SteamDBUpdate[] = [];
  
  // Simple XML parsing for RSS items
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const items = rssText.match(itemRegex) || [];

  for (const item of items) {
    try {
      const title = extractXMLContent(item, 'title');
      const link = extractXMLContent(item, 'link');
      const pubDate = extractXMLContent(item, 'pubDate');
      const description = extractXMLContent(item, 'description');
      const guid = extractXMLContent(item, 'guid');

      if (title && link && pubDate) {
        // Extract game name from title (e.g., "Risk of Rain 2 update for 3 October 2025")
        const gameNameMatch = title.match(/^(.+?)\s+update\s+for/i);
        const gameTitle = gameNameMatch ? gameNameMatch[1] : title;

        // Extract build number from guid (e.g., "build#20196450")
        const buildMatch = guid.match(/build#(\d+)/);
        const buildNumber = buildMatch ? buildMatch[1] : undefined;

        // Extract version from description if available (e.g., "V1.3.9")
        const versionMatch = description.match(/V?(\d+\.\d+(?:\.\d+)?)/i);
        const version = versionMatch ? versionMatch[1] : undefined;

        // Extract date info from title for better display  
        // const dateMatch = title.match(/update\s+for\s+(.+)$/i);
        // const updateDateText = dateMatch ? dateMatch[1] : ''; // Currently unused

        updates.push({
          appId,
          gameTitle,
          version,
          changeNumber: buildNumber,
          date: new Date(pubDate).toISOString(),
          description: description || title,
          link,
        });
      }
    } catch (error) {
      console.error('Error parsing RSS item:', error);
    }
  }

  return updates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Extract content from XML tags
 */
function extractXMLContent(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, '');
  const match = xml.match(regex);
  return match ? match[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : '';
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