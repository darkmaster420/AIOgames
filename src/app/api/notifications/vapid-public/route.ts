import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY || '';
  return NextResponse.json({ publicKey: key });
}
