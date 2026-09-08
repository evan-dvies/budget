import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);
const COOKIE = 'budget_session';
const PUBLIC_PATHS = ['/login', '/api/auth'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/api/cron')) return NextResponse.next();

  const token = request.cookies.get(COOKIE)?.value;
  if (token) {
    try {
      await jwtVerify(token, SECRET);
      return NextResponse.next();
    } catch {}
  }

  // A real page navigation (typed URL, bookmark, home-screen icon) asks for
  // text/html -- send those to the login page even under /api/, so a stale
  // bookmark to an API route reads as "please log in" instead of a bare
  // {"error":"Unauthorized"} JSON blob. Actual fetch() calls from the app
  // don't send that Accept header and get the JSON response as before.
  const wantsHtml = request.headers.get('accept')?.includes('text/html');
  if (pathname.startsWith('/api/') && !wantsHtml) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest\\.json).*)'],
};
