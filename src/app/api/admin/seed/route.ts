import { NextRequest, NextResponse } from 'next/server';
import { seedAdminUser } from '../../../../lib/seedAdmin';

export async function POST(req: NextRequest) {
  try {
    // Check if this is being called from localhost in development
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.headers.get('host')?.includes('localhost') || 
                       req.headers.get('host')?.includes('127.0.0.1');

    if (!isDevelopment || !isLocalhost) {
      return NextResponse.json(
        { error: 'Admin seeding is only allowed in development from localhost' },
        { status: 403 }
      );
    }

    const success = await seedAdminUser();
    
    if (success) {
      return NextResponse.json(
        { 
          message: 'Admin user seeding completed successfully',
          adminEmail: process.env.ADMIN_EMAIL,
          loginUrl: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/auth/signin`,
          adminUrl: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/admin`
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { error: 'Failed to seed admin user. Check console for details.' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in admin seed endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isLocalhost = req.headers.get('host')?.includes('localhost') || 
                     req.headers.get('host')?.includes('127.0.0.1');

  if (!isDevelopment || !isLocalhost) {
    return NextResponse.json(
      { error: 'Admin seeding info is only available in development from localhost' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    message: 'Admin Seeding Endpoint',
    description: 'POST to this endpoint to create/update the admin user',
    adminConfig: {
      email: process.env.ADMIN_EMAIL || 'Not configured',
      name: process.env.ADMIN_NAME || 'Not configured',
      hasPassword: !!process.env.ADMIN_PASSWORD
    },
    urls: {
      login: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/auth/signin`,
      admin: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/admin`
    },
    instructions: [
      '1. Configure ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_NAME in your .env file',
      '2. POST to this endpoint to create the admin user',
      '3. Login with the admin credentials',
      '4. Access the admin dashboard'
    ]
  });
}