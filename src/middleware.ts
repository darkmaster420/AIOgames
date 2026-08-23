import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Strangler-migration proxy to the Python backend.
 *
 * Only paths matching PORTED_PREFIXES are forwarded to FastAPI; every other
 * /api route still runs in Next, so the app keeps working while endpoints are
 * moved one at a time. As each endpoint is ported, add its prefix here and
 * delete the corresponding Next route.
 *
 * For a forwarded request we validate the NextAuth session and attach the
 * user identity plus the shared internal key, so the backend can trust the
 * headers without re-implementing NextAuth's encrypted-JWT handling. The
 * backend port must stay unpublished so these headers cannot be forged.
 */
/**
 * Ported endpoints, method-aware. A path may be served by BOTH backends at once
 * during migration — e.g. GET /api/tracking is on FastAPI while its POST/DELETE
 * are still Next routes — so each rule pins the methods that have actually moved.
 * `methods: '*'` means every method for that prefix is ported.
 */
type PortedRule = { prefix: string; methods: string[] | '*' };

const PORTED_RULES: PortedRule[] = [
  // Diagnostics: proves the proxy + auth handoff end to end.
  { prefix: '/api/backend', methods: '*' },
  // M1: only the read path has moved; add/remove stay on Next.
  { prefix: '/api/tracking', methods: ['GET'] },
];

const BACKEND_URL = (process.env.BACKEND_INTERNAL_URL || 'http://backend:8000').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.INTERNAL_API_SECRET || '';

function isPorted(pathname: string, method: string): boolean {
  return PORTED_RULES.some(rule => {
    const pathMatches = pathname === rule.prefix || pathname.startsWith(rule.prefix + '/');
    if (!pathMatches) return false;
    return rule.methods === '*' || rule.methods.includes(method);
  });
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // NextAuth's own endpoints always stay in Next.
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/') && isPorted(pathname, request.method)) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rebuild headers: strip any client-supplied x-aio-* so they cannot be
    // spoofed, then set the trusted identity and the internal key.
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) {
      if (key.toLowerCase().startsWith('x-aio-')) headers.delete(key);
    }
    headers.set('x-aio-internal-key', INTERNAL_KEY);
    headers.set('x-aio-user-id', String(token.id));
    headers.set('x-aio-user-role', String((token as { role?: string }).role || 'user'));
    if (token.email) headers.set('x-aio-user-email', String(token.email));

    return NextResponse.rewrite(`${BACKEND_URL}${pathname}${search}`, {
      request: { headers },
    });
  }

  // Legacy behaviour: auth pages are disabled in this single-owner deployment.
  if (pathname.startsWith('/auth/')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
