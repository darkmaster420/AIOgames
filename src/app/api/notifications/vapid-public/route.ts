import { NextResponse } from 'next/server';
import { getPublicVapidKey } from '../../../../utils/vapidKeys';

export async function GET() {
  const key = getPublicVapidKey();
  
  if (!key) {
    return NextResponse.json(
      { error: 'VAPID key not configured' },
      { status: 500 }
    );
  }
  
  return NextResponse.json({ key });
}
