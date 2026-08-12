import { NextResponse } from 'next/server';

export async function DELETE() {
  return NextResponse.json(
    { error: 'Account deletion is unavailable in shared-library mode.' },
    { status: 405 },
  );
}
