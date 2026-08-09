import { db } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await db.query<{ now: string }>('SELECT NOW() as now');
    const { rows: counts } = await db.query<{ n: string }>(
      'SELECT COUNT(*)::text as n FROM transactions',
    );
    return Response.json({
      ok: true,
      dbTime: rows[0]?.now,
      transactionCount: Number(counts[0]?.n ?? 0),
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
