import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes (excluding /auth/signin which needs special handling for redirect-after-login)
  const publicRoutes = [
    '/auth/signup',
    '/api/auth',
    '/api/gameapi', // Internal GameAPI should be accessible for game search
    '/api/health', // Health check endpoint should be public
    '/api/cache/warm', // Cache warming endpoint should be public for automated systems
    '/api/tracking/check-updates', // Update checking endpoint should be public for automated systems
    '/api/updates/check', // Main update check endpoint used by scheduler
    '/api/steam', // Steam API endpoints (appid, search)
    '/icon.svg',
  ];

  // Always allow static assets and public routes straight through
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Get session token (JWT strategy)
  let token;
  try {
    token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: 'next-auth.session-token',
    });
    
    // Debug logging in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Middleware] Path: ${pathname}, Token: ${token ? 'valid' : 'none'}`);
      if (!token) {
        const cookies = request.cookies.getAll();
        console.log('[Middleware] Available cookies:', cookies.map(c => c.name));
      }
    }
  } catch (error) {
    console.error('Token validation error:', error);
    // If token validation fails, treat as unauthenticated
    token = null;
  }

  // Signed-in users visiting the sign-in page should be redirected away
  if (pathname.startsWith('/auth/signin')) {
    if (token) {
      const redirectUrl = new URL('/', request.url);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  // If unauthenticated and accessing a non-public route, redirect to sign-in
  if (!token) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Admin route protection (allow both admin and owner roles)
  if ((pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) && 
      token.role !== 'admin' && token.role !== 'owner') {
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