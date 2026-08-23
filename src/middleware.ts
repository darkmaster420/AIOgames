import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Strangler migration to the Python backend.
 *
 * Only paths+methods in PORTED_RULES are proxied to FastAPI; everything else
 * still runs in Next, so the app keeps working while endpoints move one at a
 * time. A path can be served by both backends at once (e.g. GET /api/tracking
 * on FastAPI while its POST/DELETE stay on Next). `methods: '*'` = all methods.
 *
 * The proxy reuses the session `token` the auth gate already validated and
 * attaches the user identity + shared internal key, so the backend trusts the
 * headers without re-implementing NextAuth's encrypted JWT. The backend port is
 * unpublished, so those headers cannot be forged from outside.
 */
type PortedRule = { prefix: string; methods: string[] | '*' };

const PORTED_RULES: PortedRule[] = [
  { prefix: '/api/backend', methods: '*' },   // diagnostics
  { prefix: '/api/tracking', methods: ['GET'] }, // M1: read path only
];

const BACKEND_URL = (process.env.BACKEND_INTERNAL_URL || 'http://aiogames-backend:8000').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.INTERNAL_API_SECRET || '';

function isPorted(pathname: string, method: string): boolean {
  return PORTED_RULES.some(rule => {
    const pathMatches = pathname === rule.prefix || pathname.startsWith(rule.prefix + '/');
    return pathMatches && (rule.methods === '*' || rule.methods.includes(method));
  });
}

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
    '/api/games/recent', // Allow anonymous users to see recent games on homepage
    '/api/games/links', // Allow anonymous users to fetch post download links from search cards
    '/api/updates/recent', // Allow anonymous users to see recent game uploads
    '/api/proxy-image', // Image proxy must be public so posters load on the homepage for anon users
    '/api/rss/feed', // Token-auth RSS; readers and browsers hit this without a session cookie
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
  const isAdminOrOwner = token.role === 'admin' || token.role === 'owner';
  if ((pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) && !isAdminOrOwner) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Ported endpoints go to the Python backend. Reached only after the auth gate
  // above, so `token` is present and admin routes are already protected.
  if (pathname.startsWith('/api/') && isPorted(pathname, request.method)) {
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) {
      if (key.toLowerCase().startsWith('x-aio-')) headers.delete(key);
    }
    headers.set('x-aio-internal-key', INTERNAL_KEY);
    headers.set('x-aio-user-id', String(token.id ?? token.sub ?? ''));
    headers.set('x-aio-user-role', String(token.role ?? 'user'));
    if (token.email) headers.set('x-aio-user-email', String(token.email));

    return NextResponse.rewrite(`${BACKEND_URL}${pathname}${request.nextUrl.search}`, {
      request: { headers },
    });
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