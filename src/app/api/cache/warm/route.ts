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

    // Warm cache by fetching recent games
    try {
      const recentResponse = await fetch(`${baseUrl}/recent?limit=100`, {
        cache: 'no-store'
      });
      if (recentResponse.ok) {
        const recentData = await recentResponse.json();
        
        // Validate the response before considering it successful
        if (!recentData.success || !recentData.results || !Array.isArray(recentData.results)) {
          throw new Error('Invalid response structure from GameAPI');
        }
        
        const gameCount = recentData.results.length;
        
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