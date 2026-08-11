import { NextResponse } from 'next/server';

import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { detectSequel } from '../../../../utils/sequelDetection';
import { cleanGameTitle, cleanGameTitlePreserveEdition, decodeHtmlEntities, resolvePubTimestampFromBuild, resolvePubTimestampFromVersion } from '../../../../utils/steamApi';
import logger from '../../../../utils/logger';
import { sendUpdateNotification, createUpdateNotificationData } from '../../../../utils/notifications';
import { searchGames, getRecentUploads } from '../../../../lib/gameapi';
import { syncRssDownloadLinksCache } from '../../../../lib/trackedGameDownloadLinks';
import { dispatchAutoDownloadToJd2 } from '../../../../lib/jd2AutoDownloads';

import { calculateGameSimilarity } from '../../../../utils/titleMatching';

import {
  compareVersions,
  detectVersionScheme,
  enrichVersionInfoWithSteamDb,
  extractVersionInfo,
  fetchDownloadLinks,
  parsePubTimestamp,
  type GameSearchResult,
  type VersionInfo,
} from '../../../../lib/updateVersioning';

interface TrackedGameDocument {
  _id: string;
  title: string;
  lastKnownVersion?: string;
  originalTitle?: string;
  versionNumberVerified?: boolean;
  currentVersionNumber?: string;
  buildNumberVerified?: boolean;
  currentBuildNumber?: string;
  steamVerified?: boolean;
  steamAppId?: number;
  steamName?: string;
}

const TRAILING_ROMAN_TO_ARABIC: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13',
  xiv: '14',
  xv: '15',
};

const TRAILING_ARABIC_TO_ROMAN: Record<string, string> = Object.fromEntries(
  Object.entries(TRAILING_ROMAN_TO_ARABIC).map(([roman, arabic]) => [arabic, roman])
);

function buildSearchTitleVariants(input: string): string[] {
  const base = String(input || '').trim().toLowerCase();
  if (!base) return [];

  const variants = new Set<string>([base]);

  const trailingRomanMatch = base.match(/\b(xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b\s*$/i);
  if (trailingRomanMatch) {
    const roman = trailingRomanMatch[1].toLowerCase();
    const arabic = TRAILING_ROMAN_TO_ARABIC[roman];
    if (arabic) {
      variants.add(base.replace(/\b(xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b\s*$/i, arabic));
    }
  }

  const trailingArabicMatch = base.match(/\b(1[0-5]|[1-9])\b\s*$/);
  if (trailingArabicMatch) {
    const arabic = trailingArabicMatch[1];
    const roman = TRAILING_ARABIC_TO_ROMAN[arabic];
    if (roman) {
      variants.add(base.replace(/\b(1[0-5]|[1-9])\b\s*$/, roman));
    }
  }

  return Array.from(variants);
}

// Helper function to check if we can auto-approve based on version/build numbers
async function canAutoApprove(game: TrackedGameDocument, newVersionInfo: VersionInfo, versionComparison?: { isNewer: boolean; changeType: string; significance: number; suspiciousVersion?: { isSuspicious: boolean; reason?: string } }): Promise<{canApprove: boolean; reason: string}> {
  let currentInfo: VersionInfo = {
    version: '',
    build: '',
    releaseType: '',
    updateType: '',
    baseTitle: '',
    fullVersionString: '',
    confidence: 0,
    needsUserConfirmation: false,
    // The shared VersionInfo requires these; this route's old local copy had
    // them optional, so an empty baseline silently lacked them and every
    // comparison against it took the "no date/regular version" path.
    isDateVersion: false,
    hasRegularVersion: false
  };
  
  logger.debug('Checking auto-approval conditions');

  if (game.steamAppId) {
    newVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, newVersionInfo);
  }

  // If publication timestamp already proved this update is newer, trust that signal.
  if (versionComparison?.isNewer && versionComparison.changeType === 'pub_timestamp') {
    return {
      canApprove: true,
      reason: 'Publication timestamp indicates a newer release'
    };
  }

  // If a version scheme mismatch was detected (e.g., game tracked as Build XXXXXXX but the
  // new release uses semver like v0.4.4f10), we cannot numerically compare across schemes.
  // The outer boost already verified strong title similarity + update indicator signals,
  // so we trust that context and auto-approve rather than silently dropping the update.
  if (versionComparison?.changeType === 'scheme_mismatch_unverified') {
    return {
      canApprove: true,
      reason: 'Version scheme changed (e.g., build number → semantic version). Strong title and update-indicator match confirm this is a valid update.'
    };
  }
  
  // Check if version is suspicious - if so, require user confirmation
  if (versionComparison?.suspiciousVersion?.isSuspicious) {
    return {
      canApprove: false,
      reason: `Suspicious version pattern detected: ${versionComparison.suspiciousVersion.reason}. Please verify before approving.`
    };
  }

  // If the outer comparison (which already incorporates pubdate resolution) shows a clear version or
  // build increase with significance >= 2, trust it directly instead of re-running the comparison.
  // This covers build-only updates (Build X → Build Y) and suffix patches (v0.4.3 → v0.4.3f).
  if (
    versionComparison?.isNewer &&
    (versionComparison.significance ?? 0) >= 2 &&
    versionComparison.changeType !== 'unknown' &&
    !versionComparison.changeType?.startsWith('rejected_')
  ) {
    return {
      canApprove: true,
      reason: `Version/build comparison indicates a newer release (${versionComparison.changeType}, significance: ${versionComparison.significance})`
    };
  }
  
  // First try verified version number
  if (game.versionNumberVerified && game.currentVersionNumber) {
    currentInfo = extractVersionInfo(game.currentVersionNumber);
    if (game.steamAppId) {
      currentInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, currentInfo);
    }
  logger.debug(`Checking verified version number: ${game.currentVersionNumber}`);
    
    const comparison = compareVersions(currentInfo, newVersionInfo);
    
    // Block suspicious versions even if version is verified
    if (comparison.suspiciousVersion?.isSuspicious) {
      return {
        canApprove: false,
        reason: `Suspicious version pattern detected: ${comparison.suspiciousVersion.reason}. Please verify before approving.`
      };
    }
    
    if (comparison.isNewer && comparison.significance >= 2) {
      return {
        canApprove: true,
        reason: `Verified version number shows significant update (${comparison.changeType}, significance: ${comparison.significance})`
      };
    }
  }

  // Then try verified build number
  if (game.buildNumberVerified && game.currentBuildNumber) {
    if (newVersionInfo.build) {
      logger.debug(`Checking verified build number: ${game.currentBuildNumber} vs ${newVersionInfo.build}`);
      const currentBuild = parseInt(game.currentBuildNumber);
      const newBuild = parseInt(newVersionInfo.build);
      if (!isNaN(currentBuild) && !isNaN(newBuild) && newBuild > currentBuild) {
        return {
          canApprove: true,
          reason: `Verified build number is higher (${currentBuild} -> ${newBuild})`
        };
      }
    } else if (newVersionInfo.version) {
      // New post has version but no build - try version comparison
      const currentInfo = extractVersionInfo(game.currentBuildNumber);
      if (currentInfo.version || game.currentVersionNumber) {
        const currentVersion = currentInfo.version || game.currentVersionNumber || '';
        if (currentVersion && newVersionInfo.version) {
          const comparison = compareVersions(
            { ...currentInfo, version: currentVersion },
            newVersionInfo
          );
          if (comparison.isNewer && comparison.significance >= 2) {
            return {
              canApprove: true,
              reason: `Version is newer (${currentVersion} -> ${newVersionInfo.version}), build not available in new post`
            };
          }
        }
      }
    }
  }

  // Try each title source in priority order
  // 0. Explicitly stored version/build numbers (most reliable baseline for comparison)
  // 1. Original title (most likely to have accurate version info)
  // 2. Last known version (previously verified)
  // 3. Steam enhanced title (if available)
  // 4. Clean title (fallback)
  const titleSources = [
    ...(game.currentVersionNumber ? [{ title: game.currentVersionNumber, label: 'current version number' }] : []),
    ...(game.currentBuildNumber ? [{ title: `Build ${game.currentBuildNumber}`, label: 'current build number' }] : []),
    { title: game.originalTitle, label: 'original title' },
    { title: game.lastKnownVersion, label: 'last known version' },
    { title: game.steamName, label: 'Steam enhanced title' },
    { title: game.title, label: 'clean title' }
  ].filter(source => source.title); // Remove undefined/null titles

  logger.debug('Checking version from available sources');

  for (const source of titleSources) {
    // Skip if title is undefined (shouldn't happen due to filter, but TypeScript doesn't know that)
    if (!source.title) continue;

    currentInfo = extractVersionInfo(source.title);
    if (game.steamAppId) {
      currentInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, currentInfo);
    }
    
    // If we found any version or build info, use this source
    if (currentInfo.version || currentInfo.build) {
      break;
    }
  }
    
    // Only proceed if we found a version or build number in both current and new
    if ((currentInfo.version && newVersionInfo.version) || (currentInfo.build && newVersionInfo.build)) {
      const comparison = compareVersions(currentInfo, newVersionInfo);
      
      // Block suspicious versions
      if (comparison.suspiciousVersion?.isSuspicious) {
        return {
          canApprove: false,
          reason: `Suspicious version pattern detected: ${comparison.suspiciousVersion.reason}. Please verify before approving.`
        };
      }
      
      // Auto-approve if:
      // 1. It's clearly a newer version with high significance
      if (comparison.isNewer && comparison.significance >= 2) {
        return {
          canApprove: true,
          reason: `Extracted version shows significant update (${comparison.changeType}, significance: ${comparison.significance})`
        };
      }
      
      // 2. We have build numbers and the new one is higher
      if (currentInfo.build && newVersionInfo.build) {
        const currentBuild = parseInt(currentInfo.build.replace(/[^\d]/g, ''));
        const newBuild = parseInt(newVersionInfo.build.replace(/[^\d]/g, ''));
        if (!isNaN(currentBuild) && !isNaN(newBuild) && newBuild > currentBuild) {
          return {
            canApprove: true,
            reason: `Extracted build number is higher (${currentBuild} -> ${newBuild})`
          };
        }
      }
      
      // 3. Clear version bump (e.g., 1.0 to 1.1, or 1.1 to 2.0)
      if (currentInfo.version && newVersionInfo.version && 
          comparison.isNewer && 
          comparison.changeType !== 'unknown' &&
          comparison.changeType !== 'patch') {
        return {
          canApprove: true,
          reason: `Clear version bump detected (${currentInfo.version} -> ${newVersionInfo.version})`
        };
      }
    }

  // No version info found to compare or auto-approval criteria met
  return {
    canApprove: false,
    reason: 'No clear version increase detected that meets auto-approval criteria'
  };
}

// POST: Check for updates for a specific game using the search API
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId } = await request.json();

    if (!gameId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find the game to check
    const game = await TrackedGame.findOne({
      _id: gameId,
      userId: user.id,
      isActive: true
    });

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    logger.info(`🎮 Checking updates for single game: ${game.title}`);

    let updatesFound = 0;
    let sequelsFound = 0;
    const results = [];

    // Get the clean title for matching results against tracked title.
    // Also compute a cleaned Steam name so similarity checks can use the best score of either.
    const cleanTitle = cleanGameTitle(game.title);
    const cleanSteamTitle = game.steamName ? cleanGameTitle(game.steamName) : null;

    // Build search query: prefer Steam name (most accurate) then fall back to cleaned title.
    // This is important for games whose scene/tracker title differs from the Steam name
    // (e.g. "Schedule I" vs "Schedule 1").
    const steamSearchBase = game.steamName
      ? cleanGameTitlePreserveEdition(game.steamName)
      : cleanGameTitlePreserveEdition(game.title);
    const fallbackSearchBase = cleanGameTitlePreserveEdition(game.title);

    // Merge variants from both sources (deduplicated) so we catch both spellings
    const allVariantSet = new Set<string>([
      ...buildSearchTitleVariants(steamSearchBase),
      ...buildSearchTitleVariants(fallbackSearchBase),
    ]);
    const searchVariants = Array.from(allVariantSet);

    logger.debug(`🔍 Searching for variants: ${searchVariants.map(v => `"${v}"`).join(', ')} (steam="${game.steamName || 'none'}", title="${game.title}")`);

    // Use the integrated gameapi module for search
    const mergedResults: GameSearchResult[] = [];

    // Fetch title-based search results AND the recent-uploads feed in parallel.
    // The search endpoint has an in-memory cache: if a post was published after
    // the cache was last populated, it won't appear in search results. The recent-uploads
    // feed catches new posts that haven't yet made it into the search cache.
    const [searchResponses, recentResponse] = await Promise.allSettled([
      Promise.all(
        searchVariants.map(variant =>
          searchGames(variant)
            .then(d => (d.success && Array.isArray(d.results)) ? d.results as GameSearchResult[] : null)
            .catch(e => { logger.warn(`Search error for "${variant}":`, e); return null; })
        )
      ),
      getRecentUploads()
        .then(d => (d.success && Array.isArray(d.results)) ? d.results as GameSearchResult[] : null)
        .catch(e => { logger.warn('Recent-uploads fetch error:', e); return null; })
    ]);

    if (searchResponses.status === 'fulfilled') {
      for (const batch of searchResponses.value) {
        if (batch) mergedResults.push(...batch);
      }
    }

    // Merge recent-uploads: only include results that have reasonable title similarity
    // so we don't bloat the processing set with completely unrelated games.
    if (recentResponse.status === 'fulfilled' && recentResponse.value) {
      const recentPosts = recentResponse.value;
      logger.debug(`📰 Recent-uploads feed returned ${recentPosts.length} posts`);
      for (const post of recentPosts) {
        const postClean = cleanGameTitle(decodeHtmlEntities(post.title));
        const sim = Math.max(
          calculateGameSimilarity(cleanTitle, postClean),
          cleanSteamTitle ? calculateGameSimilarity(cleanSteamTitle, postClean) : 0
        );
        if (sim >= 0.70) {
          mergedResults.push(post);
          logger.debug(`📰 Added from recent feed (sim=${sim.toFixed(2)}): "${post.title}"`);
        }
      }
    }

    // Extract results from merged API responses
    let games: GameSearchResult[] = [];
    if (mergedResults.length > 0) {
      games = mergedResults;
    } else {
      throw new Error('Search API request returned no results for all title variants');
    }
    
    logger.debug(`📊 Search returned ${games.length} results`);

    // Remove duplicate posts by link (same post can appear multiple times)
    try {
      const seenLinks = new Map<string, GameSearchResult>();
      for (const g of games) {
        const key = g.link || g.id || g.title;
        const date = g.date ? new Date(g.date) : new Date(0);
        const existing = seenLinks.get(key);
        if (!existing) {
          seenLinks.set(key, g);
        } else {
          // Keep the one with the newer date if duplicates found
          const existingDate = existing.date ? new Date(existing.date) : new Date(0);
          if (date > existingDate) seenLinks.set(key, g);
        }
      }

      games = Array.from(seenLinks.values());
      // Sort by date (newest first) to check newer versions first
      games.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
      
      logger.debug(`🔎 Processing ${games.length} unique results (sorted by date)`);
    } catch (dedupeErr) {
      logger.error('Failed to deduplicate search results:', dedupeErr);
      // fall back to original games list
    }

    // Process results to find updates and sequels
    for (const result of games) {
      const decodedTitle = decodeHtmlEntities(result.title);
      const cleanedDecodedTitle = cleanGameTitle(decodedTitle);
      // Use the best similarity between the tracked title and the Steam name so that
      // games like "Schedule I" (tracked) still match results titled "Schedule 1 v0.4.3f".
      const similarity = Math.max(
        calculateGameSimilarity(cleanTitle, cleanedDecodedTitle),
        cleanSteamTitle ? calculateGameSimilarity(cleanSteamTitle, cleanedDecodedTitle) : 0
      );

      logger.debug(`Processing: "${decodedTitle}" (similarity: ${similarity.toFixed(2)})`);

      // Skip if this is the same post we're already tracking
      if (result.link === game.gameLink) {
        logger.debug(`⏩ Skipping current tracked post: "${decodedTitle}"`);
        continue;
      }

      // --- Require a valid version/build pattern in the detected title (but be more lenient) ---
      // Use ESM import for detectVersionNumber
      // IMPORTANT: Check the ORIGINAL decoded title, not the cleaned one (which strips versions)
      const { detectVersionNumber } = await import('../../../../utils/versionDetection');
      const { found: hasVersion } = detectVersionNumber(decodedTitle);
      const hasBuild = /\b(build|b|#)\s*\d{3,}\b/i.test(decodedTitle);
      const hasDatePattern = /\b\d{4}[-\.]\d{2}[-\.]\d{2}\b/.test(decodedTitle);
      const hasUpdateKeywords = /\b(update|patch|v\d|rev|repack|hotfix|fixed|latest|final|complete|enhanced|improved)\b/i.test(decodedTitle);
      
      logger.debug(`🔍 Pattern check - hasVersion: ${hasVersion}, hasBuild: ${hasBuild}, hasDate: ${hasDatePattern}, hasKeywords: ${hasUpdateKeywords}`);
      
      if (!hasVersion && !hasBuild && !hasDatePattern && !hasUpdateKeywords) {
        logger.debug(`⏩ Skipping "${decodedTitle}" (no version/build/update pattern)`);
        continue;
      }

      // Check for potential updates (more lenient similarity threshold)
      if (similarity >= 0.75) {
        // Try sources in priority order for current version
        const titleSources = [
          // Explicitly-stored version/build numbers are the most reliable baseline
          ...(game.currentVersionNumber ? [{ title: game.currentVersionNumber, label: 'current version number' }] : []),
          ...(game.currentBuildNumber ? [{ title: `Build ${game.currentBuildNumber}`, label: 'current build number' }] : []),
          { title: game.originalTitle, label: 'original title' },
          { title: game.lastKnownVersion, label: 'last known version' },
          { title: game.steamName, label: 'Steam enhanced title' },
          { title: game.title, label: 'clean title' }
        ].filter(source => source.title);

        let currentVersionInfo = null;
        for (const source of titleSources) {
          if (!source.title) continue;
          
          const info = extractVersionInfo(source.title);
          if (info.version || info.build) {
            logger.debug(`✅ Using version info from ${source.label}: "${source.title}"`);
            currentVersionInfo = info;
            break;
          }
        }
        
        // If we didn't find any version info, use the last source
        if (!currentVersionInfo) {
          currentVersionInfo = extractVersionInfo(titleSources[titleSources.length - 1].title);
        }

        let newVersionInfo = extractVersionInfo(decodedTitle);

        // Enrich version/build via SteamDB Worker if one side is missing and we know the appId
        if (game.steamAppId) {
          try {
            currentVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, currentVersionInfo);
            newVersionInfo = await enrichVersionInfoWithSteamDb(game.steamAppId, newVersionInfo);
          } catch (e) {
            logger.debug('ℹ️ SteamDB enrichment skipped due to error:', e instanceof Error ? e.message : 'unknown');
          }
        }
        
        let comparison = compareVersions(currentVersionInfo, newVersionInfo);
        const currentScheme = detectVersionScheme(currentVersionInfo);
        const newScheme = detectVersionScheme(newVersionInfo);
        const schemesMismatchOrUnknown = currentScheme !== newScheme || currentScheme === 'unknown' || newScheme === 'unknown';

        // --- Resolve current pub timestamp ---
        // Priority: SteamDB build (most accurate) → SteamDB version → stored lastPubTimestamp → lastVersionDate
        let currentPubTimestamp = 0;

        if (game.steamAppId && (game.currentBuildNumber || currentVersionInfo.build)) {
          const currentBuildForTimestamp = game.currentBuildNumber || currentVersionInfo.build;
          if (currentBuildForTimestamp) {
            const resolvedCurrentPubTs = await resolvePubTimestampFromBuild(game.steamAppId, currentBuildForTimestamp);
            if (typeof resolvedCurrentPubTs === 'number' && resolvedCurrentPubTs > 0) {
              currentPubTimestamp = resolvedCurrentPubTs;
              logger.debug(`🕒 Resolved current pub timestamp from SteamDB build ${currentBuildForTimestamp}: ${currentPubTimestamp}`);
            }
          }
        }

        if (currentPubTimestamp <= 0 && game.steamAppId && (game.currentVersionNumber || currentVersionInfo.version)) {
          const currentVersionForTimestamp = game.currentVersionNumber || currentVersionInfo.version;
          if (currentVersionForTimestamp) {
            const resolvedCurrentPubTsFromVersion = await resolvePubTimestampFromVersion(game.steamAppId, currentVersionForTimestamp);
            if (typeof resolvedCurrentPubTsFromVersion === 'number' && resolvedCurrentPubTsFromVersion > 0) {
              currentPubTimestamp = resolvedCurrentPubTsFromVersion;
              logger.debug(`🕒 Resolved current pub timestamp from SteamDB version ${currentVersionForTimestamp}: ${currentPubTimestamp}`);
            }
          }
        }

        if (currentPubTimestamp <= 0 && typeof game.lastPubTimestamp === 'number' && game.lastPubTimestamp > 0) {
          currentPubTimestamp = game.lastPubTimestamp;
          logger.debug(`🕒 Using stored lastPubTimestamp as current baseline: ${currentPubTimestamp}`);
        }

        if (currentPubTimestamp <= 0) {
          currentPubTimestamp = parsePubTimestamp(game.lastVersionDate);
          if (currentPubTimestamp > 0) {
            logger.debug(`🕒 Using stored post date as current baseline: ${currentPubTimestamp}`);
          }
        }

        // --- Resolve new pub timestamp ---
        // Priority: SteamDB build (most accurate) → SteamDB version → feed date
        // We always try SteamDB first because feed/post dates from scene sites are
        // unreliable proxies; the Steam build pub_timestamp is the authoritative source.
        let newPubTimestamp = 0;

        if (game.steamAppId && newVersionInfo.build) {
          const resolvedPubTs = await resolvePubTimestampFromBuild(game.steamAppId, newVersionInfo.build);
          if (typeof resolvedPubTs === 'number' && resolvedPubTs > 0) {
            newPubTimestamp = resolvedPubTs;
            logger.debug(`🕒 Resolved new pub timestamp from SteamDB build ${newVersionInfo.build}: ${newPubTimestamp}`);
          }
        }

        if (newPubTimestamp <= 0 && game.steamAppId && newVersionInfo.version) {
          const resolvedPubTsFromVersion = await resolvePubTimestampFromVersion(game.steamAppId, newVersionInfo.version);
          if (typeof resolvedPubTsFromVersion === 'number' && resolvedPubTsFromVersion > 0) {
            newPubTimestamp = resolvedPubTsFromVersion;
            logger.debug(`🕒 Resolved new pub timestamp from SteamDB version ${newVersionInfo.version}: ${newPubTimestamp}`);
          }
        }

        if (newPubTimestamp <= 0) {
          newPubTimestamp = parsePubTimestamp(result.date);
          if (newPubTimestamp > 0) {
            logger.debug(`🕒 Using feed date as new pub timestamp fallback: ${newPubTimestamp}`);
          }
        }

        // Last-resort fallback: if the current baseline was resolved from post date AND the new
        // result has a feed date, compare the two post dates directly.
        // This lets us at least say "the scene post is newer than the one we're tracking" when
        // SteamDB has no data for either side.
        const currentPostDate = parsePubTimestamp(game.lastVersionDate);
        const newPostDate = parsePubTimestamp(result.date);
        if (newPubTimestamp <= 0 && currentPubTimestamp <= 0 && currentPostDate > 0 && newPostDate > 0) {
          // Both sides only have post dates — compare them directly
          logger.debug(`🕒 Post-date vs post-date fallback: current=${currentPostDate}, new=${newPostDate}`);
          currentPubTimestamp = currentPostDate;
          newPubTimestamp = newPostDate;
        } else if (newPubTimestamp <= 0 && currentPubTimestamp > 0 && newPostDate > 0) {
          // Current has a proper baseline but new only has its post date — use post date for new
          newPubTimestamp = newPostDate;
          logger.debug(`🕒 Using new post date as fallback for new pub timestamp: ${newPubTimestamp}`);
        }

        // Absolute last resort: if we still have no current baseline, use the game's dateAdded.
        // Semantically: "the game was last known-good when tracking started, so any post after
        // that date is potentially newer." This handles scheme-switch cases (build→semver) where
        // lastVersionDate and lastPubTimestamp are both unset.
        if (currentPubTimestamp <= 0 && (newPubTimestamp > 0 || newPostDate > 0)) {
          const dateAddedTs = parsePubTimestamp(game.dateAdded);
          if (dateAddedTs > 0) {
            currentPubTimestamp = dateAddedTs;
            if (newPubTimestamp <= 0) newPubTimestamp = newPostDate;
            logger.debug(`🕒 Last-resort baseline: dateAdded=${dateAddedTs}, new pub timestamp=${newPubTimestamp}`);
          }
        }

        const hasComparablePubTimestamps = currentPubTimestamp > 0 && newPubTimestamp > 0;
        const pubTimestampDelta = hasComparablePubTimestamps ? (newPubTimestamp - currentPubTimestamp) : 0;

        if (hasComparablePubTimestamps && pubTimestampDelta !== 0) {
          comparison = {
            ...comparison,
            isNewer: pubTimestampDelta > 0,
            changeType: pubTimestampDelta > 0 ? 'pub_timestamp' : 'pub_timestamp_older',
            significance: pubTimestampDelta > 0 ? Math.max(comparison.significance, 1) : 0,
          };
          logger.debug(`🕒 Publication timestamp precedence (${currentScheme} vs ${newScheme}): ${currentPubTimestamp} -> ${newPubTimestamp}`);
        }

        // When schemes are incompatible and pub_timestamp didn't resolve it, don't trust string comparison
        if (schemesMismatchOrUnknown && comparison.changeType !== 'pub_timestamp' && comparison.changeType !== 'pub_timestamp_older') {
          comparison = {
            ...comparison,
            isNewer: false,
            changeType: 'scheme_mismatch_unverified',
            significance: 0,
          };
          logger.debug(`⚠️ Scheme mismatch (${currentScheme} vs ${newScheme}) — skipping string comparison, pub_timestamp required`);
        }

        logger.debug(`📊 Comparison: isNewer=${comparison.isNewer}, current="${currentVersionInfo.version || currentVersionInfo.build}", new="${newVersionInfo.version || newVersionInfo.build}"`);
        
        // Version/regex detection
        let isUpdateCandidate = false;
        
        // Primary detection: version comparison
        isUpdateCandidate = comparison.isNewer || newVersionInfo.needsUserConfirmation;
        
        // Boost for strong update indicators
        const titleLower = decodedTitle.toLowerCase();
        const gameTitle = game.title.toLowerCase();
        
        const updateKeywords = [
          'update', 'patch', 'hotfix', 'build', 'version', 'v\\d', 'rev', 'fixed',
          'bugfix', 'new version', 'latest', 'improved', 'enhanced', 'repack',
          'director.*cut', 'goty', 'complete.*edition', 'final.*cut'
        ];
        
        let updateIndicators = 0;
        for (const keyword of updateKeywords) {
          const regex = new RegExp(keyword, 'i');
          if (regex.test(titleLower) && !regex.test(gameTitle)) {
            updateIndicators++;
          }
        }
        
        const versionPatterns = [
          /v\d+\.\d+\.\d+/i, /\d+\.\d+\.\d+/, /build\s*\d+/i, /patch\s*\d+/i,
          /update\s*\d+/i, /rev\s*\d+/i, /r\d+/i, /v\d{8}/i, /\d{4}[-\.]\d{2}[-\.]\d{2}/
        ];
        
        for (const pattern of versionPatterns) {
          if (pattern.test(decodedTitle)) {
            updateIndicators++;
          }
        }
        
        // Boost if strong indicators present — but never override a definitive "older" result.
        // Also allow scheme_mismatch_unverified: this fires when schemes differ (e.g. tracked as
        // build-number, new post uses semver) and pub_timestamp couldn't resolve it. In that case
        // strong update signals (version pattern + update keyword) are the only reliable guide.
        if (updateIndicators >= 2 && similarity >= 0.85 &&
            (comparison.isNewer || comparison.changeType === 'unknown' || comparison.changeType === 'scheme_mismatch_unverified')) {
          isUpdateCandidate = true;
        }
        
        logger.debug(`🎯 Final decision: isUpdateCandidate=${isUpdateCandidate}, hasVersion=${!!newVersionInfo.version}, hasBuild=${!!newVersionInfo.build}`);
        
        // Only proceed if it's a candidate and has some version info
        if (isUpdateCandidate && (newVersionInfo.version || newVersionInfo.build)) {
          logger.debug(`🔗 Download links in result:`, result.downloadLinks);
          
          // Check if we already have this update in pending or history (fresh DB query to avoid race conditions)
          const freshGame = await TrackedGame.findById(game._id).lean() as {
            updateHistory?: Array<{ version?: string; build?: string; gameLink: string }>;
          } | null;

          const candidateBuild = String(newVersionInfo.build || '').trim();
          const candidateDetectedVersion = String(newVersionInfo.fullVersionString || newVersionInfo.version || '').trim().toLowerCase();

          const isSameSignature = (entryBuild?: string, entryVersion?: string) => {
            const normalizedBuild = String(entryBuild || '').trim();
            const normalizedVersion = String(entryVersion || '').trim().toLowerCase();

            if (candidateBuild && normalizedBuild) {
              return candidateBuild === normalizedBuild;
            }

            if (candidateDetectedVersion && normalizedVersion) {
              return normalizedVersion.includes(candidateDetectedVersion) || candidateDetectedVersion.includes(normalizedVersion);
            }

            return !candidateBuild && !candidateDetectedVersion;
          };

          const existingInHistory = freshGame?.updateHistory?.some((update) =>
            update.gameLink === result.link &&
            isSameSignature(update.build, update.version)
          );
          
          if (existingInHistory) {
            logger.info(`⏩ Skipping duplicate update (already in updateHistory): ${result.link}`);
          } else {
            // Check if we can auto-approve based on verified version/build numbers
            const autoApproveResult = await canAutoApprove(game, newVersionInfo, comparison);
            logger.debug(`\n🤖 Auto-approval decision:`, autoApproveResult);
            
              // Create base update data (enhanced with AI information)
            const updateData = {
              version: decodedTitle, // Full title with version (e.g., "TEKKEN 8 v2.06.01-P2P")
              detectedVersion: newVersionInfo.fullVersionString || newVersionInfo.version || newVersionInfo.build, // Clean version number
              newTitle: cleanedDecodedTitle, // Cleaned game title without version
              newLink: result.link,
              gameLink: result.link,
              build: newVersionInfo.build,
              releaseType: newVersionInfo.releaseType,
              updateType: newVersionInfo.updateType,
              changeType: comparison.changeType,
              significance: comparison.significance,
              dateFound: new Date().toISOString(),
              pub_timestamp: parsePubTimestamp(result.date) || null,
              previousVersion: game.lastKnownVersion || game.title,
              downloadLinks: result.downloadLinks || [],
              steamEnhanced: false,
              steamAppId: game.steamAppId,
              needsUserConfirmation: !autoApproveResult.canApprove && (newVersionInfo.needsUserConfirmation || comparison.significance < 2),
              autoApprovalReason: autoApproveResult.reason,
              confidence: newVersionInfo.confidence || similarity,
              reason: autoApproveResult.reason || 'Version number detected',
            };
            let fullDownloadLinks = result.downloadLinks || [];

            if (autoApproveResult.canApprove) {
              const hasEmbeddedLinks =
                Array.isArray(result.downloadLinks) && result.downloadLinks.length > 0;
              logger.debug(`\n✅ Auto-approving update with reason: ${autoApproveResult.reason}`);
              
              // Auto-approve the update
              const approvedUpdate = {
                ...updateData,
                changeType: 'user_approved', // Use user_approved instead of automatic for proper notification formatting
                userApproved: true,
                approvedAt: new Date(),
                autoApprovalReason: autoApproveResult.reason
              };              
              
              // Update the game with auto-approved update
              const updateFields: Record<string, unknown> = {
                lastKnownVersion: newVersionInfo.fullVersionString || newVersionInfo.version || newVersionInfo.build || decodedTitle,
                lastVersionDate: new Date().toISOString(),
                lastPubTimestamp: parsePubTimestamp(result.date) || Date.now(),
                dateAdded: new Date(), // Move game to top when single-check auto-approved update is detected
                title: cleanedDecodedTitle,
                originalTitle: decodedTitle,
                gameLink: result.link,
                // Update source info so download links fetch from the correct site
                ...(result.id && { gameId: result.id }),
                ...(result.source && { source: result.source }),
                ...(result.image && { image: result.image }),
                $push: {
                  updateHistory: {
                    $each: [{
                      ...approvedUpdate,
                      isLatest: true
                    }],
                    $position: 0
                  }
                },
                lastChecked: new Date(),
                latestApprovedUpdate: {
                  version: decodedTitle,
                  dateFound: new Date().toISOString(),
                  gameLink: result.link,
                  downloadLinks: result.downloadLinks || []
                },
                ...(hasEmbeddedLinks
                  ? {
                      rssCachedDownloadLinks: result.downloadLinks,
                      rssDownloadLinksFetchedAt: new Date()
                    }
                  : {}),
                // Set new update indicator for auto-approved updates
                hasNewUpdate: true,
                newUpdateSeen: false
              };

              // Update version or build numbers based on what was detected
              if (newVersionInfo.version) {
                updateFields.currentVersionNumber = newVersionInfo.version;
                updateFields.versionNumberVerified = true;
                updateFields.versionNumberSource = 'automatic';
                updateFields.versionNumberLastUpdated = new Date();
                logger.debug(`✅ Updated version number to: ${newVersionInfo.version}`);
              }
              
              if (newVersionInfo.build) {
                updateFields.currentBuildNumber = newVersionInfo.build;
                updateFields.buildNumberVerified = true;
                // Distinguish SteamDB-enriched builds from title-extracted builds
                const titleExtracted = extractVersionInfo(result.title || '');
                updateFields.buildNumberSource = (titleExtracted.build === newVersionInfo.build) ? 'automatic' : 'steamdb_auto';
                updateFields.buildNumberLastUpdated = new Date();
                logger.debug(`✅ Updated build number to: ${newVersionInfo.build}`);
              } else if (newVersionInfo.version) {
                // New update has version but no build - clear stale build data
                updateFields.currentBuildNumber = '';
                updateFields.buildNumberVerified = false;
                updateFields.buildNumberSource = '';
                logger.debug(`✅ Cleared stale build number (new update has version only: ${newVersionInfo.version})`);
              }

              // Atomic conditional update to prevent duplicate auto-approvals
              const hasCandidateSignature = !!(candidateBuild || candidateDetectedVersion);

              const autoApproveResult2 = await TrackedGame.findOneAndUpdate(
                hasCandidateSignature
                  ? { _id: game._id }
                  : {
                      _id: game._id,
                      'updateHistory.gameLink': { $ne: result.link }
                    },
                updateFields,
                { new: true }
              );

              if (!autoApproveResult2) {
                logger.info(`⏩ Skipping duplicate auto-approval (atomic check): ${result.link}`);
                continue;
              }

              let rssFilledFromAutoDownloadFetch = false;

              if (fullDownloadLinks.length === 0) {
                fullDownloadLinks = await fetchDownloadLinks(result);
                if (fullDownloadLinks.length > 0) {
                  rssFilledFromAutoDownloadFetch = true;
                  await TrackedGame.updateOne(
                    { _id: game._id },
                    {
                      $set: {
                        rssCachedDownloadLinks: fullDownloadLinks,
                        rssDownloadLinksFetchedAt: new Date()
                      }
                    }
                  );
                }
              }

              await dispatchAutoDownloadToJd2({
                userId: game.userId.toString(),
                trackedGameId: String(game._id),
                gameTitle: game.title,
                version: decodedTitle,
                gameLink: result.link,
                downloadLinks: fullDownloadLinks,
              });

              if (!hasEmbeddedLinks && !rssFilledFromAutoDownloadFetch) {
                void syncRssDownloadLinksCache(String(game._id)).catch(() => {});
              }
              
            } else {
              logger.debug(`⏩ Skipping update that could not be auto-approved: "${decodedTitle}" (${autoApproveResult.reason})`);
              continue;
            }

            // Send notification for the update only if enabled for this game
            if (game.notificationsEnabled) {
              try {
                const notificationData = createUpdateNotificationData({
                  gameTitle: game.title,
                  version: decodedTitle,
                  updateType: 'update', // Always 'update' for version updates
                  gameLink: result.link,
                  imageUrl: result.image ?? undefined,
                  downloadLinks: fullDownloadLinks,
                  previousVersion: game.lastKnownVersion || game.title,
                  trackedGameId: String(game._id),
                });
                
                logger.debug(`📤 Notification data:`, {
                  downloadLinks: notificationData.downloadLinks,
                  hasDownloadLinks: !!(notificationData.downloadLinks && notificationData.downloadLinks.length > 0)
                });
                
                await sendUpdateNotification(game.userId.toString(), notificationData);
                
                // Mark notification as sent in updateHistory
                await TrackedGame.updateOne(
                  { _id: game._id, 'updateHistory.gameLink': result.link },
                  { $set: { 'updateHistory.$.notificationSent': true } }
                );
                
                logger.debug(`📢 Auto-approved update notification sent for ${game.title}`);
              } catch (notificationError) {
                logger.error(`Failed to send update notification for ${game.title}:`, notificationError);
                // Don't fail the whole operation if notification fails
              }
            } else {
              logger.info(`Update found for ${game.title} but notifications are disabled`);
            }

            updatesFound++;
            results.push({
              gameTitle: game.title,
              update: updateData,
              autoApproved: autoApproveResult.canApprove
            });
            
            const status = '✅ Auto-approved';
            logger.info(`${status} update for ${game.title}: ${newVersionInfo.fullVersionString || newVersionInfo.version || decodedTitle}`);
            
            // For single check, only process the first (newest) update
            break;
          }
        }
      }
      
      // Check for sequels (moderate similarity)
      else if (similarity >= 0.5) {
        logger.debug(`🎲 Checking for sequel match in: ${decodedTitle}`);
        
        const sequelResult = await detectSequel(game.title, decodedTitle);
        
        if (sequelResult && sequelResult.isSequel) {
          logger.debug(`🎮 Potential sequel found: ${decodedTitle}`);
          
          // Add to sequel notifications if not already there
          const existingSequel = game.sequelNotifications?.some((sequel: { detectedTitle: string; gameLink: string }) => 
            sequel.detectedTitle === decodedTitle && sequel.gameLink === result.link
          );
          
          if (!existingSequel) {
            // Send sequel notification
            try {
              const notificationData = createUpdateNotificationData({
                gameTitle: game.title,
                gameLink: result.link,
                imageUrl: result.image ?? undefined,
                updateType: 'sequel'
              });
              
              await sendUpdateNotification(game.userId.toString(), notificationData);
              logger.debug(`📢 Sequel notification sent for ${game.title} -> ${decodedTitle}`);
            } catch (notificationError) {
              logger.error(`Failed to send sequel notification for ${game.title}:`, notificationError);
              // Don't fail the whole operation if notification fails
            }

            sequelsFound++;
            results.push({
              gameTitle: game.title,
              sequel: {
                title: decodedTitle,
                link: result.link,
                similarity,
                type: sequelResult?.sequelType || 'unknown'
              }
            });
            
            logger.debug(`📝 Added sequel notification for ${game.title}: ${decodedTitle}`);
          }
        }
      }
    }

    logger.debug(`\n✨ Check complete for ${game.title}:`);
    logger.debug(`   Updates found: ${updatesFound}`);
    logger.debug(`   Sequels found: ${sequelsFound}`);

    return NextResponse.json({
      message: 'Game check complete',
      game: game.title,
      checked: 1,
      updatesFound,
      sequelsFound,
      results
    });

  } catch (error) {
    logger.error('Single game check error:', error);
    return NextResponse.json(
      { error: 'Failed to check game for updates' },
      { status: 500 }
    );
  }
}
