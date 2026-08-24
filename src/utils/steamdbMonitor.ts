/**
 * SteamDB update monitoring for Steam-verified games.
 *
 * steamdb.info is Cloudflare-blocked on a direct fetch, so the PatchnotesRSS is
 * sourced through the Python backend (which uses the CF solver) via
 * getSteamDbBuilds, then mapped to the SteamDBUpdate shape this module exposes.
 */

import { getSteamDbBuilds } from './steamApi';

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

// In-memory cache (the backend does its own fetching + rate limiting).
const STEAMDB_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const steamdbCache = new Map<string, { timestamp: number; updates: SteamDBUpdate[] }>();
const pendingFetches = new Map<string, Promise<SteamDBUpdate[]>>();

/**
 * Patch notes for a Steam app, sourced from the backend SteamDB builds.
 */
export async function fetchSteamDBUpdates(appId: string): Promise<SteamDBUpdate[]> {
  const id = String(appId || '').trim();
  if (!id) return [];
  try {
    const cached = steamdbCache.get(id);
    if (cached && Date.now() - cached.timestamp < STEAMDB_CACHE_TTL_MS) {
      return cached.updates;
    }

    const inFlight = pendingFetches.get(id);
    if (inFlight) return inFlight;

    const fetchPromise = (async (): Promise<SteamDBUpdate[]> => {
      // Builds come from the backend (steamdb.info PatchnotesRSS via the solver);
      // map each to the SteamDBUpdate shape this module exposes.
      const builds = await getSteamDbBuilds(id);
      const updates: SteamDBUpdate[] = builds.map((b) => {
        const title = b.title || '';
        const nameMatch = title.match(/^(.+?)\s+update\s+for/i);
        const buildId = b.build_id ? String(b.build_id) : undefined;
        let date = '';
        if (b.published_at) {
          const parsed = new Date(b.published_at);
          date = Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
        }
        return {
          appId: id,
          gameTitle: nameMatch ? nameMatch[1] : title,
          version: b.version || undefined,
          changeNumber: buildId,
          date,
          description: b.description || title,
          link: buildId ? `https://steamdb.info/patchnotes/${buildId}/` : '',
        };
      });
      if (updates.length > 0 || !cached) {
        steamdbCache.set(id, { timestamp: Date.now(), updates });
      }
      return updates;
    })().finally(() => {
      pendingFetches.delete(id);
    });

    pendingFetches.set(id, fetchPromise);
    return await fetchPromise;
  } catch (error) {
    console.error(`Error fetching SteamDB updates for app ${appId}:`, error);
    const cached = steamdbCache.get(id);
    if (cached) return cached.updates;
    return [];
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