import { matchTransfers } from '@/lib/transferMatch';

export async function POST() {
  try {
    const result = await matchTransfers();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
