import { db } from '@/lib/db';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { category_id } = await request.json();

  if (!category_id) {
    return Response.json({ error: 'Missing category_id' }, { status: 400 });
  }

  try {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE transactions
       SET category_id = $1, category_source = 'manual'
       WHERE id = $2
       RETURNING id`,
      [category_id, id],
    );
    if (rows.length === 0) {
      return Response.json({ error: 'Transaction not found' }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
