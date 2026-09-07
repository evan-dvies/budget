import { db } from '@/lib/db';

export async function PATCH(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  const { amount } = await request.json();

  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Response.json({ error: 'amount must be a positive number' }, { status: 400 });
  }

  try {
    // Budgets are versioned by date (see schema.sql), not edited in place,
    // so a past month keeps showing the limit that was actually in force
    // then. If this category's already been edited today, update that
    // row in place instead of opening a second version for the same day.
    const { rows: todayRows } = await db.query<{ id: string }>(
      `UPDATE budgets SET amount = $1
       WHERE category_id = $2 AND effective_to IS NULL AND effective_from = CURRENT_DATE
       RETURNING id`,
      [parsed, categoryId],
    );

    if (todayRows.length === 0) {
      // Closes out any prior version (0 rows affected if this category
      // never had a budget, which is fine -- the insert below still
      // starts a fresh one).
      await db.query(
        `UPDATE budgets SET effective_to = CURRENT_DATE
         WHERE category_id = $1 AND effective_to IS NULL`,
        [categoryId],
      );
      await db.query(
        `INSERT INTO budgets (category_id, period, amount, effective_from, effective_to)
         VALUES ($1, 'monthly', $2, CURRENT_DATE, NULL)`,
        [categoryId, parsed],
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
