import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';

export async function GET() {
  try {
    // Check if user has admin access
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if AI detection worker URL is configured
    const workerUrl = process.env.AI_DETECTION_WORKER_URL;
    
    if (!workerUrl) {
      return NextResponse.json({
        configured: false,
        status: 'not_configured',
        message: 'AI detection worker URL not configured'
      });
    }

    // Test if the worker is reachable
    try {
      const healthPath = process.env.AI_DETECTION_HEALTH_PATH || '/health';
      const healthUrl = workerUrl.endsWith('/') ? workerUrl + healthPath.slice(1) : workerUrl + healthPath;
      
      const healthResponse = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        return NextResponse.json({
          configured: true,
          status: 'available',
          message: 'AI detection worker is online and responding',
          workerInfo: healthData
        });
      } else {
        return NextResponse.json({
          configured: true,
          status: 'unavailable',
          message: `AI detection worker responded with status ${healthResponse.status}`
        });
      }
    } catch (fetchError) {
      return NextResponse.json({
        configured: true,
        status: 'unreachable',
        message: `AI detection worker is unreachable: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`
      });
    }

  } catch (error) {
    console.error('Error checking AI detection status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}