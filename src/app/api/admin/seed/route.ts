import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Account seeding is disabled in shared-library mode.' },
    { status: 410 },
  );
}
