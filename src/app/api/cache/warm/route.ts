import { NextResponse } from 'next/server';
import logger from '../../../../utils/logger';

// GET: Trigger cache warming
export async function GET() {
  try {
    const startTime = Date.now();
    logger.info('🔥 Cache warming started');

    const baseUrl = process.env.GAME_API_URL || 'https://gameapi.a7a8524.workers.dev';
    
    // Clear cache first
    try {
      const clearCacheResponse = await fetch(`${baseUrl}/clearcache`, {
        method: 'POST'
      });
      if (clearCacheResponse.ok) {
        logger.info('🗑️ Cache cleared successfully');
      } else {
        logger.warn('⚠️ Cache clear failed, continuing anyway');
      }
    } catch (cacheError) {
      logger.warn('⚠️ Cache clear error:', cacheError instanceof Error ? cacheError.message : 'Unknown error');
    }

    // Warm cache by fetching recent games
    try {
      const recentResponse = await fetch(`${baseUrl}/recent?limit=100`);
      if (recentResponse.ok) {
        const recentData = await recentResponse.json();
        const gameCount = recentData.results?.length || 0;
        
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