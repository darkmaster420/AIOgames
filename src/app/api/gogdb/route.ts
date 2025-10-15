/**
 * GOGDB API Endpoint
 * Provides access to GOG game information and version checking
 * Uses SQLite index for fast local searches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  initializeGOGDB,
  searchGOGDBIndex,
  getGOGDBProductFromIndex,
  getLatestGOGVersion,
  updateGOGDBIndex
} from '@/utils/gogdbIndex';
import logger from '@/utils/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gogdb
 * Query parameters:
 * - action: 'search' | 'product' | 'version' | 'compare' | 'update-index'
 * - query: search term (for search action)
 * - productId: GOG product ID (for product, version, compare actions)
 * - os: 'windows' | 'mac' | 'linux' (for version actions, default: windows)
 * - currentVersion: current version (for compare action)
 * - currentBuild: current build (for compare action)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Initialize GOGDB index
    await initializeGOGDB();

    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const query = searchParams.get('query');
    const productIdStr = searchParams.get('productId');
    const os = (searchParams.get('os') || 'windows') as 'windows' | 'mac' | 'linux';
    const currentVersion = searchParams.get('currentVersion') || undefined;
    const currentBuild = searchParams.get('currentBuild') || undefined;

    logger.info(`📦 GOGDB API request: action=${action}, query=${query}, productId=${productIdStr}`);

    // Search for games using index
    if (action === 'search') {
      if (!query) {
        return NextResponse.json(
          { error: 'Query parameter is required for search action' },
          { status: 400 }
        );
      }

      const results = await searchGOGDBIndex(query, 10);
      return NextResponse.json({
        success: true,
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          slug: r.slug,
          type: r.type,
          releaseDate: r.release_date,
          developers: r.developers,
          publishers: r.publishers
        })),
        count: results.length,
        source: 'index'
      });
    }

    // Get product details from index
    if (action === 'product') {
      if (!productIdStr) {
        return NextResponse.json(
          { error: 'productId parameter is required for product action' },
          { status: 400 }
        );
      }

      const productId = parseInt(productIdStr, 10);
      if (isNaN(productId)) {
        return NextResponse.json(
          { error: 'Invalid productId' },
          { status: 400 }
        );
      }

      const product = await getGOGDBProductFromIndex(productId);
      if (!product) {
        return NextResponse.json(
          { error: 'Product not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        product,
        source: 'index'
      });
    }

    // Get latest version
    if (action === 'version') {
      if (!productIdStr) {
        return NextResponse.json(
          { error: 'productId parameter is required for version action' },
          { status: 400 }
        );
      }

      const productId = parseInt(productIdStr, 10);
      if (isNaN(productId)) {
        return NextResponse.json(
          { error: 'Invalid productId' },
          { status: 400 }
        );
      }

      const versionInfo = await getLatestGOGVersion(productId, os);
      if (!versionInfo) {
        // Try to get more details about why it failed
        logger.warn(`⚠️ No version info found for GOG product ${productId}`);
        return NextResponse.json(
          { 
            error: 'No version information found',
            productId,
            os,
            suggestion: 'The product may not have any builds available for the specified OS'
          },
          { 
            status: 404,
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate' // Don't cache 404s
            }
          }
        );
      }

      return NextResponse.json({
        success: true,
        ...versionInfo,
        os
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200'
        }
      });
    }

    // Compare versions
    if (action === 'compare') {
      if (!productIdStr) {
        return NextResponse.json(
          { error: 'productId parameter is required for compare action' },
          { status: 400 }
        );
      }

      const productId = parseInt(productIdStr, 10);
      if (isNaN(productId)) {
        return NextResponse.json(
          { error: 'Invalid productId' },
          { status: 400 }
        );
      }

      const latestInfo = await getLatestGOGVersion(productId, os);
      if (!latestInfo) {
        return NextResponse.json(
          { error: 'No version information found' },
          { status: 404 }
        );
      }

      // Compare versions
      let hasUpdate = false;
      
      if (currentVersion && latestInfo.version) {
        hasUpdate = currentVersion !== latestInfo.version;
      } else if (currentBuild && latestInfo.buildId) {
        hasUpdate = currentBuild !== latestInfo.buildId;
      } else if (latestInfo.version || latestInfo.buildId) {
        // We have GOG version but no current version - assume update available
        hasUpdate = true;
      }

      return NextResponse.json({
        success: true,
        hasUpdate,
        latestVersion: latestInfo.version,
        latestBuild: latestInfo.buildId,
        latestDate: latestInfo.date,
        currentVersion,
        currentBuild
      });
    }

    // Update index manually
    if (action === 'update-index') {
      try {
        await updateGOGDBIndex();
        return NextResponse.json({
          success: true,
          message: 'GOGDB index updated successfully'
        });
      } catch (error) {
        return NextResponse.json(
          { error: 'Failed to update index', details: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        );
      }
    }

    // Invalid action
    return NextResponse.json(
      { 
        error: 'Invalid action. Supported actions: search, product, version, compare, update-index' 
      },
      { status: 400 }
    );

  } catch (error) {
    logger.error('❌ GOGDB API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
