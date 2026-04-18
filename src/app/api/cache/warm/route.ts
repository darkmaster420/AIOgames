import { NextResponse } from 'next/server';
import logger from '../../../../utils/logger';

// Import the cache clearing function
async function clearLocalCache() {
  try {
    // Clear the in-memory cache in the recent games endpoint
    const response = await fetch(process.env.NEXTAUTH_URL + '/api/cache/clear', {
      method: 'POST'
    });
    return response.ok;
  } catch (error) {
    logger.warn('⚠️ Could not clear local cache:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

// GET: Trigger cache warming
export async function GET() {
  try {
    const startTime = Date.now();
    logger.info('🔥 Cache warming started');

    const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
    
    // Clear local Next.js cache first
    await clearLocalCache();
    
    // Clear GameAPI cache
    try {
      const clearCacheResponse = await fetch(`${baseUrl}/clearcache`, {
        method: 'POST'
      });
      if (clearCacheResponse.ok) {
        logger.info('🗑️ GameAPI cache cleared successfully');
      } else {
        logger.warn('⚠️ GameAPI cache clear failed, continuing anyway');
      }
    } catch (cacheError) {
      logger.warn('⚠️ GameAPI cache clear error:', cacheError instanceof Error ? cacheError.message : 'Unknown error');
    }

    // Warm the in-memory cache by hitting /api/games/recent directly
    // This populates the actual cache that serves homepage requests
    try {
      const internalBaseUrl = process.env.NODE_ENV === 'production'
        ? process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
        : `http://127.0.0.1:${process.env.PORT || 3000}`;
      
      const recentResponse = await fetch(`${internalBaseUrl}/api/games/recent`, {
        cache: 'no-store'
      });
      if (recentResponse.ok) {
        const recentData = await recentResponse.json();
        const gameCount = Array.isArray(recentData) ? recentData.length : 0;
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        logger.info(`🔥✅ Cache warmed successfully: ${gameCount} games loaded in ${duration}ms`);
        
        return NextResponse.json({
          success: true,
          message: 'Cache warmed successfully',
          gameCount,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error(`Recent API failed: ${recentResponse.status}`);
      }
    } catch (fetchError) {
      logger.error('❌ Cache warming failed:', fetchError);
      return NextResponse.json({
        success: false,
        error: 'Failed to warm cache',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown error'
      }, { status: 500 });
    }

  } catch (error) {
    logger.error('❌ Cache warming error:', error);
    return NextResponse.json({
      success: false,
      error: 'Cache warming failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST: Same as GET for consistency
export async function POST() {
  return GET();
}