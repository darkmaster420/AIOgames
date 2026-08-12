import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Accounts are disabled in shared-library mode.' },
    { status: 410 },
  );
}
