import { db } from '@/lib/db';
import { claimAccessUrl } from '@/lib/simplefin';

export async function POST(request: Request) {
  const { setup_token } = await request.json();

  if (!setup_token) {
    return Response.json({ error: 'Missing setup_token' }, { status: 400 });
  }

  try {
    // Exchange the one-time token for a permanent access URL
    const accessUrl = await claimAccessUrl(setup_token);

    // Store it — this is a secret, treat it like a password
    await db.query(
      `INSERT INTO simplefin_access (access_url_enc, created_at)
       VALUES ($1, NOW())
       ON CONFLICT DO NOTHING`,
      [Buffer.from(accessUrl)],
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    console.error('SimpleFIN setup error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
