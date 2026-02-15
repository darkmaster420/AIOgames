import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Public user registration is disabled
  // Only admins can create new users via /api/admin/users/create
  return NextResponse.json(
    { error: 'Public registration is disabled. Please contact an administrator to create an account.' },
    { status: 403 }
  );
}
