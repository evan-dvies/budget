import { plaid } from '@/lib/plaid';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  // Allow both the cron job (CRON_SECRET) and direct calls from the dashboard
  const auth = request.headers.get('authorization');
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = request.headers.get('x-internal') === 'true';

  if (!isCron && !isInternal) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { rows: items } = await db.query<{
    id: string;
    plaid_item_id: string;
    access_token_enc: Buffer;
    sync_cursor: string | null;
  }>(`SELECT id, plaid_item_id, access_token_enc, sync_cursor
      FROM plaid_items
      WHERE needs_reauth = false`);

  const results = [];

  for (const item of items) {
    const access_token = item.access_token_enc.toString();
    let cursor = item.sync_cursor ?? undefined;
    let added = 0, modified = 0, removed = 0;

    try {
      // Loop until Plaid says has_more = false (handles pagination)
      let hasMore = true;
      while (hasMore) {
        const syncRes = await plaid.transactionsSync({
          access_token,
          cursor,
          count: 500,
        });

        const { added: a, modified: m, removed: r, next_cursor, has_more } = syncRes.data;

        // Get account IDs for this item
        const { rows: accounts } = await db.query<{ id: string; plaid_account_id: string }>(
          `SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = $1`,
          [item.plaid_item_id],
        );
        const accountMap = new Map(accounts.map((ac) => [ac.plaid_account_id, ac.id]));

        // Insert new transactions
        for (const txn of a) {
          const accountId = accountMap.get(txn.account_id);
          if (!accountId) continue;

          // Negate Plaid's amount: Plaid positive = money out, we want negative = money out
          const amount = -(txn.amount);
          const desc = txn.name ?? '';
          const clean = desc.toUpperCase().replace(/\s+/g, ' ').trim();

          await db.query(
            `INSERT INTO transactions
               (account_id, posted_date, authorized_date, amount, currency,
                description_raw, description_clean, merchant_name, pending,
                source, external_id, fingerprint, fingerprint_seq)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'plaid', $10, $11, 0)
             ON CONFLICT (external_id) DO UPDATE
               SET amount       = EXCLUDED.amount,
                   pending      = EXCLUDED.pending,
                   posted_date  = EXCLUDED.posted_date`,
            [
              accountId,
              txn.date,
              txn.authorized_date ?? null,
              amount,
              txn.iso_currency_code ?? 'CAD',
              desc,
              clean,
              txn.merchant_name ?? null,
              txn.pending,
              txn.transaction_id,
              // Fingerprint for Plaid rows: just use the transaction_id
              `plaid_${txn.transaction_id}`,
            ],
          );
          added++;
        }

        // Update modified transactions
        for (const txn of m) {
          await db.query(
            `UPDATE transactions
                SET amount = $1, pending = $2, posted_date = $3, updated_at = NOW()
              WHERE external_id = $4`,
            [-(txn.amount), txn.pending, txn.date, txn.transaction_id],
          );
          modified++;
        }

        // Remove deleted transactions
        for (const txn of r) {
          await db.query(`DELETE FROM transactions WHERE external_id = $1`, [txn.transaction_id]);
          removed++;
        }

        cursor = next_cursor;
        hasMore = has_more;
      }

      // Save the cursor so next sync only fetches the delta
      await db.query(
        `UPDATE plaid_items SET sync_cursor = $1, last_synced_at = NOW() WHERE id = $2`,
        [cursor, item.id],
      );

      results.push({ item_id: item.plaid_item_id, added, modified, removed });
    } catch (err: any) {
      const code = err?.response?.data?.error_code;

      // If the bank needs re-auth, flag it so the dashboard shows a banner
      if (code === 'ITEM_LOGIN_REQUIRED') {
        await db.query(
          `UPDATE plaid_items SET needs_reauth = true, last_error = $1 WHERE id = $2`,
          [code, item.id],
        );
      }

      results.push({ item_id: item.plaid_item_id, error: code ?? 'unknown' });
    }
  }

  return Response.json({ ok: true, results });
}
