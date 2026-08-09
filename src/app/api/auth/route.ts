import { cookies } from 'next/headers';
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);
const COOKIE = 'budget_session';

export async function POST(request: Request) {
  const { password } = await request.json();

  if (password !== process.env.DASHBOARD_PASSWORD) {
    // Small delay to slow down brute force attempts
    await new Promise((r) => setTimeout(r, 500));
    return Response.json({ ok: false, error: 'Wrong password' }, { status: 401 });
  }

  // Create a signed JWT that expires in 30 days
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,       // JS can't read it — prevents XSS stealing the session
    secure: true,         // HTTPS only
    sameSite: 'strict',   // CSRF protection
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  return Response.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
  return Response.json({ ok: true });
}
