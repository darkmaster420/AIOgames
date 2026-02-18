import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes (excluding /auth/signin which needs special handling for redirect-after-login)
  const publicRoutes = [
    '/api/auth',
    '/api/health', // Health check endpoint should be public
    '/api/cache/warm', // Cache warming endpoint should be public for automated systems
    '/api/tracking/check-updates', // Update checking endpoint should be public for automated systems
    '/api/updates/check', // Main update check endpoint used by scheduler
    '/api/steam', // Steam API endpoints (appid, search)
    '/api/telegram', // Telegram webhook endpoint must be public
    '/api/games/search', // Allow anonymous users to search for games
    '/api/updates/recent', // Allow anonymous users to see recent game uploads
    '/icon.svg',
  ];

  // Always allow static assets and public routes straight through
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Get session token (JWT strategy)
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Signed-in users visiting the sign-in page should be redirected away
  if (pathname.startsWith('/auth/signin')) {
    if (token) {
      const redirectUrl = new URL('/', request.url);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  // Allow anonymous access to the home page for searching games
  if (pathname === '/') {
    return NextResponse.next();
  }

  // If unauthenticated and accessing a non-public route, redirect to sign-in
  if (!token) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Admin route protection
  if ((pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) && token.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};