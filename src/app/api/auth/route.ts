import { cookies } from 'next/headers';
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);
const COOKIE = 'budget_session';

export async function POST(request: Request) {
  const { password } = await request.json();
  if (password !== process.env.DASHBOARD_PASSWORD) {
    await new Promise((r) => setTimeout(r, 500));
    return Response.json({ ok: false, error: 'Wrong password' }, { status: 401 });
  }
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(SECRET);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 30, path: '/',
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
  return Response.json({ ok: true });
}
