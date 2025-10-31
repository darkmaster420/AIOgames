import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { TrackedGame } from '../../../../lib/models';
import connectDB from '../../../../lib/db';

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
        webm: { 480: string; max: string };
        mp4: { 480: string; max: string };
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

// GET: Get detailed game information by Steam App ID
// Optimized for speed: uses SteamSpy first, Steam Store as optional enhancement
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

    // Start with SteamSpy (fast and reliable) - run in parallel with Steam Store
    const fetchSteamSpy = async (): Promise<SteamSpyData | null> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      
      try {
        const response = await fetch(
          `https://steamspy.com/api.php?request=appdetails&appid=${appid}`,
          {
            signal: controller.signal,
            next: { revalidate: 3600 },
          }
        );
        clearTimeout(timeout);
        
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        clearTimeout(timeout);
      }
      return null;
    };

    // Try Steam Store API (slower, optional)
    const fetchSteamStore = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      try {
        const response = await fetch(
          `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=US`,
          {
            signal: controller.signal,
            next: { revalidate: 7200 },
          }
        );
        clearTimeout(timeout);
        
        if (response.ok) {
          const json = await response.json();
          if (json[appid]?.success && json[appid]?.data) {
            return json[appid].data;
          }
        }
      } catch (error) {
        clearTimeout(timeout);
      }
      return null;
    };

    // Fetch both in parallel for maximum speed
    const [steamSpyData, steamStoreData] = await Promise.all([
      fetchSteamSpy(),
      fetchSteamStore(),
    ]);

    // If we have neither source, return error
    if (!steamSpyData && !steamStoreData) {
      return NextResponse.json(
        { error: 'Game not found or unavailable from all sources' },
        { status: 404 }
      );
    }

    // Build response prioritizing available data
    const response: Record<string, unknown> = {
      appid: parseInt(appid),
      name: steamStoreData?.name || steamSpyData?.name || 'Unknown',
      type: steamStoreData?.type || 'game',
      description: steamStoreData?.detailed_description || steamStoreData?.about_the_game || '',
      short_description: steamStoreData?.short_description || steamSpyData?.name || '',
      header_image: steamStoreData?.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      background: steamStoreData?.background || steamStoreData?.background_raw || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/page_bg_generated_v6b.jpg`,
      screenshots: steamStoreData?.screenshots || [],
      movies: steamStoreData?.movies || [],
      developers: steamStoreData?.developers || (steamSpyData?.developer ? [steamSpyData.developer] : []),
      publishers: steamStoreData?.publishers || (steamSpyData?.publisher ? [steamSpyData.publisher] : []),
      release_date: steamStoreData?.release_date,
      platforms: steamStoreData?.platforms,
      metacritic: steamStoreData?.metacritic,
      categories: steamStoreData?.categories,
      genres: steamStoreData?.genres,
      price_overview: steamStoreData?.price_overview,
      isTracked: false,
      dataSource: steamStoreData ? 'steam+steamspy' : 'steamspy',
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
          response.lastKnownVersion = trackedGame.lastKnownVersion;
          response.hasNewUpdate = trackedGame.hasNewUpdate || false;
          response.steamVerified = trackedGame.steamVerified;
          response.buildNumberVerified = trackedGame.buildNumberVerified;
          response.currentBuildNumber = trackedGame.currentBuildNumber;
          
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

          // Include pending updates
          if (trackedGame.pendingUpdates && trackedGame.pendingUpdates.length > 0) {
            response.pendingUpdates = trackedGame.pendingUpdates.map((update: {_id: {toString: () => string}; newTitle?: string; detectedVersion?: string; dateFound?: Date; reason?: string}) => ({
              _id: update._id.toString(),
              newTitle: update.newTitle,
              detectedVersion: update.detectedVersion,
              dateFound: update.dateFound,
              reason: update.reason,
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
