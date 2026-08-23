import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { TrackedGame } from '../../../../lib/models';
import connectDB from '../../../../lib/db';
import { resolveIGDBImage } from '../../../../utils/igdb';
import { getSteamAppDetails } from '../../../../utils/steamApi';

interface SteamSpyData {
  appid: number;
  name: string;
  developer?: string;
  publisher?: string;
  score_rank?: string;
  positive?: number;
  negative?: number;
  userscore?: number;
  owners?: string;
  average_forever?: number;
  average_2weeks?: number;
  median_forever?: number;
  median_2weeks?: number;
  price?: string;
  initialprice?: string;
  discount?: string;
  ccu?: number;
  languages?: string;
  genre?: string;
  tags?: Record<string, number>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface SteamGameDetails {
  [appid: string]: {
    success: boolean;
    data?: {
      type: string;
      name: string;
      steam_appid: number;
      required_age: number;
      is_free: boolean;
      detailed_description: string;
      about_the_game: string;
      short_description: string;
      header_image: string;
      background: string;
      background_raw: string;
      screenshots?: Array<{
        id: number;
        path_thumbnail: string;
        path_full: string;
      }>;
      movies?: Array<{
        id: number;
        name: string;
        thumbnail: string;
        webm?: { 480?: string; max?: string };
        mp4?: { 480?: string; max?: string };
        hls_h264?: string;
        dash_h264?: string;
        dash_av1?: string;
      }>;
      developers?: string[];
      publishers?: string[];
      release_date: {
        coming_soon: boolean;
        date: string;
      };
      platforms: {
        windows: boolean;
        mac: boolean;
        linux: boolean;
      };
      metacritic?: {
        score: number;
        url: string;
      };
      categories?: Array<{ id: number; description: string }>;
      genres?: Array<{ id: string; description: string }>;
      price_overview?: {
        currency: string;
        initial: number;
        final: number;
        discount_percent: number;
        initial_formatted: string;
        final_formatted: string;
      };
    };
  };
}

function detectImageSource(url: string | null): 'steamapi' | 'igdb' | 'rawg' | 'none' {
  if (!url) return 'none';
  const u = url.toLowerCase();
  if (u.includes('images.igdb.com')) return 'igdb';
  if (u.includes('media.rawg.io')) return 'rawg';
  return 'steamapi';
}

// GET: Get detailed game information by Steam App ID.
// Source priority:
// 1) SteamSpy (primary game metadata)
// 2) Steam Store API (fallback/extended metadata)
// 3) IGDB image
// 4) RAWG image fallback (inside resolveIGDBImage)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ appid: string }> }
) {
  try {
    const { appid } = await params;

    if (!appid || isNaN(parseInt(appid))) {
      return NextResponse.json(
        { error: 'Valid Steam App ID is required' },
        { status: 400 }
      );
    }

    const steamDetails = await getSteamAppDetails(appid).catch(() => null);
    const steamSpyData = (steamDetails?.sources?.steamspy || null) as SteamSpyData | null;
    const steamStoreData = (steamDetails?.sources?.steam || null) as {
      type?: string;
      name?: string;
      detailed_description?: string;
      about_the_game?: string;
      short_description?: string;
      header_image?: string;
      background?: string;
      background_raw?: string;
      screenshots?: Array<{ id: number; path_thumbnail: string; path_full: string }>;
      movies?: Array<{
        id: number;
        name: string;
        thumbnail: string;
        webm?: { 480?: string; max?: string };
        mp4?: { 480?: string; max?: string };
        hls_h264?: string;
        dash_h264?: string;
        dash_av1?: string;
      }>;
      developers?: string[];
      publishers?: string[];
      release_date?: {
        coming_soon: boolean;
        date: string;
      };
      platforms?: {
        windows: boolean;
        mac: boolean;
        linux: boolean;
      };
      metacritic?: {
        score: number;
        url: string;
      };
      categories?: Array<{ id: number; description: string }>;
      genres?: Array<{ id: string; description: string }>;
      price_overview?: {
        currency: string;
        initial: number;
        final: number;
        discount_percent: number;
        initial_formatted: string;
        final_formatted: string;
      };
      drm_notice?: string;
    } | null;

    // If we have neither source, return error
    // If we have neither Steam source, try DB + IGDB fallback
    if (!steamSpyData && !steamStoreData) {
      // Check if we have this game tracked in our DB
      let trackedGame = null;
      try {
        await connectDB();
        trackedGame = await TrackedGame.findOne({
          steamAppId: parseInt(appid),
          isActive: { $ne: false },
        });
      } catch { /* continue */ }

      if (!trackedGame) {
        return NextResponse.json(
          { error: 'Game not found or unavailable from all sources' },
          { status: 404 }
        );
      }

      // Build a minimal response from tracked data + IGDB
      const igdbImage = await resolveIGDBImage(trackedGame.steamName || trackedGame.title || '');
      const response: Record<string, unknown> = {
        appid: parseInt(appid),
        name: trackedGame.steamName || trackedGame.title || 'Unknown',
        type: 'game',
        description: '',
        short_description: '',
        header_image: igdbImage || trackedGame.image || '',
        background: '',
        screenshots: [],
        movies: [],
        developers: [],
        publishers: [],
        isTracked: false,
        dataSource: 'db+igdb',
      };

      // Check if the requesting user owns this tracked game
      const user = await getCurrentUser();
      if (user && trackedGame.userId?.toString() === user.id) {
        response.isTracked = true;
        response.trackedGameId = trackedGame._id.toString();
        response.gameId = trackedGame.gameId;
        response.title = trackedGame.title;
        response.originalTitle = trackedGame.originalTitle;
        response.source = trackedGame.source;
        response.image = trackedGame.image;
        response.gameLink = trackedGame.gameLink;
        response.lastKnownVersion = trackedGame.lastKnownVersion;
        response.hasNewUpdate = trackedGame.hasNewUpdate || false;
        response.steamVerified = trackedGame.steamVerified;
        response.steamAppId = trackedGame.steamAppId;
        response.steamName = trackedGame.steamName;
      }

      return NextResponse.json(response);
    }

    // 3/4) Image fallback chain: steamapi header -> igdb -> rawg.
    const bestTitleForImage =
      steamSpyData?.name ||
      steamStoreData?.name ||
      '';
    const igdbOrRawgImage = bestTitleForImage
      ? await resolveIGDBImage(bestTitleForImage)
      : null;
    const selectedHeaderImage =
      steamStoreData?.header_image ||
      igdbOrRawgImage ||
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
    const imageSource = detectImageSource(selectedHeaderImage);

    // Build response prioritizing sources in explicit order.
    const response: Record<string, unknown> = {
      appid: parseInt(appid),
      name: steamSpyData?.name || steamStoreData?.name || 'Unknown',
      type: steamStoreData?.type || 'game',
      description: steamStoreData?.detailed_description || steamStoreData?.about_the_game || '',
      short_description: steamStoreData?.short_description || steamSpyData?.name || '',
      header_image: selectedHeaderImage,
      background: steamStoreData?.background || steamStoreData?.background_raw || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/page_bg_generated_v6b.jpg`,
      screenshots: steamStoreData?.screenshots || [],
      movies: steamStoreData?.movies || [],
      developers: (steamSpyData?.developer ? [steamSpyData.developer] : steamStoreData?.developers) || [],
      publishers: (steamSpyData?.publisher ? [steamSpyData.publisher] : steamStoreData?.publishers) || [],
      release_date: steamStoreData?.release_date,
      platforms: steamStoreData?.platforms,
      metacritic: steamStoreData?.metacritic,
      categories: steamStoreData?.categories,
      genres: steamStoreData?.genres,
      price_overview: steamStoreData?.price_overview,
      drm_notice: steamStoreData?.drm_notice || '',
      isTracked: false,
      dataSource: steamSpyData ? 'steamspy' : (steamStoreData ? 'steamapi' : 'unknown'),
      imageSource,
      sourceOrder: ['steamspy', 'steamapi', 'igdb', 'rawg'],
      sourceAvailability: {
        steamspy: !!steamSpyData,
        steamapi: !!steamStoreData,
        steamdb: !!steamDetails?.sources?.steamdb,
        igdb: imageSource === 'igdb',
        rawg: imageSource === 'rawg',
      },
      sources: {
        steamspy: steamSpyData ? {
          name: steamSpyData.name,
          developer: steamSpyData.developer,
          publisher: steamSpyData.publisher,
          owners: steamSpyData.owners,
          userscore: steamSpyData.userscore,
          positive: steamSpyData.positive,
          negative: steamSpyData.negative,
        } : null,
        steamapi: steamStoreData ? {
          name: steamStoreData.name,
          type: steamStoreData.type,
          release_date: steamStoreData.release_date,
          header_image: steamStoreData.header_image,
          has_screenshots: Array.isArray(steamStoreData.screenshots) && steamStoreData.screenshots.length > 0,
        } : null,
      },
    };

    // Add SteamSpy-specific data
    if (steamSpyData) {
      response.owners = steamSpyData.owners;
      response.positive = steamSpyData.positive;
      response.negative = steamSpyData.negative;
      response.userscore = steamSpyData.userscore;
      response.tags = steamSpyData.tags;
    }

    // Check if user is authenticated and tracking this game
    const user = await getCurrentUser();
    if (user) {
      try {
        await connectDB();
        
        const trackedGame = await TrackedGame.findOne({
          userId: user.id,
          steamAppId: parseInt(appid),
          isActive: { $ne: false },
        });

        if (trackedGame) {
          response.isTracked = true;
          response.trackedGameId = trackedGame._id.toString();
          response.gameId = trackedGame.gameId;
          response.title = trackedGame.title;
          response.originalTitle = trackedGame.originalTitle;
          response.source = trackedGame.source;
          response.image = trackedGame.image;
          response.gameLink = trackedGame.gameLink;
          response.lastKnownVersion = trackedGame.lastKnownVersion;
          response.hasNewUpdate = trackedGame.hasNewUpdate || false;
          response.steamVerified = trackedGame.steamVerified;
          response.steamAppId = trackedGame.steamAppId;
          response.steamName = trackedGame.steamName;
          response.gogVerified = trackedGame.gogVerified;
          response.gogProductId = trackedGame.gogProductId;
          response.gogName = trackedGame.gogName;
          response.gogVersion = trackedGame.gogVersion;
          response.gogBuildId = trackedGame.gogBuildId;
          response.gogLastChecked = trackedGame.gogLastChecked;
          response.buildNumberVerified = trackedGame.buildNumberVerified;
          response.currentBuildNumber = trackedGame.currentBuildNumber;
          response.versionNumberVerified = trackedGame.versionNumberVerified;
          response.currentVersionNumber = trackedGame.currentVersionNumber;
          response.notificationsEnabled = trackedGame.notificationsEnabled;
          response.dateAdded = trackedGame.dateAdded;
          response.lastChecked = trackedGame.lastChecked;
          
          // Include recent update history
          if (trackedGame.updateHistory && trackedGame.updateHistory.length > 0) {
            response.updateHistory = trackedGame.updateHistory
              .slice(-10) // Last 10 updates
              .reverse()
              .map((update: {version?: string; dateFound?: Date; gameLink?: string; isLatest?: boolean}) => ({
                version: update.version,
                dateFound: update.dateFound,
                gameLink: update.gameLink,
                isLatest: update.isLatest,
              }));
          }
        }
      } catch (dbError) {
        console.error('Error checking tracked game status:', dbError);
        // Continue without tracked data
      }
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching game details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game details' },
      { status: 500 }
    );
  }
}
