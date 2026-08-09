import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);
const COOKIE = 'budget_session';

// These paths are always public — everything else requires a valid session.
const PUBLIC_PATHS = ['/login', '/api/auth'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Also allow Vercel's cron calls through (they carry CRON_SECRET instead)
  if (pathname.startsWith('/api/cron')) {
    return NextResponse.next();
  }

  // Check for a valid session cookie
  const token = request.cookies.get(COOKIE)?.value;

  if (token) {
    try {
      await jwtVerify(token, SECRET);
      return NextResponse.next(); // Valid session — let them through
    } catch {
      // Token expired or tampered — fall through to redirect
    }
  }

  // No valid session — redirect to login
  // API routes get a 401 instead of a redirect
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on every route except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest\\.json).*)'],
};
