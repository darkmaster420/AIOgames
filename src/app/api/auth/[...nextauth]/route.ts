import { NextResponse } from 'next/server';

function accountsDisabled() {
  return NextResponse.json(
    { error: 'Accounts are disabled in shared-library mode.' },
    { status: 410 },
  );
}

export const GET = accountsDisabled;
export const POST = accountsDisabled;
