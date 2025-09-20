import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Basic health check
    return NextResponse.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      service: 'aiogames-tracker'
    });
  } catch {
    return NextResponse.json(
      { status: 'unhealthy', error: 'Service unavailable' }, 
      { status: 503 }
    );
  }
}