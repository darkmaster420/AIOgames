import { NextResponse } from 'next/server';
import connectDB from '../../../lib/db';

export async function GET() {
  try {
    // Test database connection
    let dbStatus = 'unknown';
    let dbError = null;
    try {
      await connectDB();
      dbStatus = 'connected';
    } catch (error) {
      console.warn('Health check: Database connection failed:', error);
      dbStatus = 'disconnected';
      dbError = error instanceof Error ? error.message : 'Unknown error';
    }

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'aiogames-tracker',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'unknown',
      database: {
        status: dbStatus,
        error: dbError
      },
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };

    // For Docker health checks, return 200 even if database is disconnected
    // The service can still handle requests (though with limited functionality)
    return NextResponse.json(health, { status: 200 });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        timestamp: new Date().toISOString(),
        error: 'Service unavailable',
        service: 'aiogames-tracker'
      }, 
      { status: 503 }
    );
  }
}