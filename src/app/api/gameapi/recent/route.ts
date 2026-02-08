/**
 * Recent Games API Endpoint
 * Redirects to main GameAPI with recent flag
 */

import { NextRequest } from 'next/server';
import { GET as gameApiHandler } from '../route';

export async function GET(request: NextRequest) {
  // Forward to main handler with recent flag
  const url = new URL(request.url);
  url.searchParams.set('recent', 'true');
  
  const newRequest = new NextRequest(url.toString(), request);
  return gameApiHandler(newRequest);
}
