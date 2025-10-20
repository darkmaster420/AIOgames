import { NextResponse } from 'next/server';
import logger from '../../../../utils/logger';
import { clearRecentGamesCache } from '../../games/recent/route';

// POST: Clear local Next.js cache
export async function POST() {
  try {
    logger.info('🗑️ Clearing local Next.js cache...');
    
    // Clear the in-memory cache for recent games
    clearRecentGamesCache();
    
    logger.info('✅ Local cache cleared');
    
    return NextResponse.json({
      success: true,
      message: 'Local cache cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('❌ Cache clear error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to clear cache',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// GET: Same as POST for convenience
export async function GET() {
  return POST();
}
