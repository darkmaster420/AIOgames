import { NextResponse } from 'next/server';
import logger from '../../../../utils/logger';

// POST: Clear local Next.js cache
export async function POST() {
  try {
    logger.info('🗑️ Clearing local Next.js cache...');
    
    // Note: In-memory cache clearing removed due to Next.js 15 route export restrictions
    // Cache will naturally expire based on TTL settings
    
    logger.info('✅ Cache clear requested (will expire naturally)');
    
    return NextResponse.json({
      success: true,
      message: 'Cache clear requested - will expire based on TTL',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('❌ Cache clear error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process cache clear request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// GET: Same as POST for convenience
export async function GET() {
  return POST();
}
