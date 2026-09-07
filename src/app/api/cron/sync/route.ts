export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Trigger SimpleFIN sync
  const base = new URL(request.url).origin;
  const res = await fetch(`${base}/api/simplefin/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const data = await res.json();
  return Response.json({ ok: true, ranAt: new Date().toISOString(), sync: data });
}
