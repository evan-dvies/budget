import { db } from '@/lib/db';
import { fetchAccounts, parseAmount } from '@/lib/simplefin';
import { cleanDescription } from '@/lib/import/normalize';
import { fingerprintOf } from '@/lib/import/fingerprint';
import { categorizeWithContext, loadCategorizationContext } from '@/lib/categorize';
import { matchTransfers } from '@/lib/transferMatch';

/**
 * SimpleFIN doesn't expose an account-type field in the shape we consume,
 * so infer credit cards from the name -- good enough for the institutions
 * actually connected. Anything else defaults to depository.
 */
function inferAccountType(name: string): 'credit' | 'depository' {
  return /visa|mastercard|amex|credit/i.test(name) ? 'credit' : 'depository';
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization');
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = request.headers.get('x-internal') === 'true';

  if (!isCron && !isInternal) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch the stored access URL
  const { rows } = await db.query<{ access_url_enc: Buffer }>(
    `SELECT access_url_enc FROM simplefin_access LIMIT 1`,
  );

  if (rows.length === 0) {
    return Response.json({ error: 'No SimpleFIN connection found. Set up SimpleFIN first.' }, { status: 400 });
  }

  const accessUrl = rows[0].access_url_enc.toString();

  // Fetch last 30 days of transactions
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  try {
    const { accounts, errors } = await fetchAccounts(accessUrl, startDate, endDate);

    if (errors.length > 0) {
      console.warn('SimpleFIN errors:', errors);
    }

    let totalAdded = 0;
    let totalSkipped = 0;
    const { rules, leafCategories } = await loadCategorizationContext();

    for (const sfAccount of accounts) {
      // Upsert the account
      const { rows: acctRows } = await db.query<{ id: string }>(
        `INSERT INTO accounts
           (name, institution, type, currency, current_balance, balance_as_of, source, simplefin_account_id)
         VALUES ($1, $2, $3, $4, $5, NOW(), 'simplefin', $6)
         ON CONFLICT (simplefin_account_id) DO UPDATE
           SET current_balance = EXCLUDED.current_balance,
               balance_as_of   = NOW(),
               type            = EXCLUDED.type
         RETURNING id`,
        [
          sfAccount.name,
          sfAccount.org?.name ?? 'Unknown',
          inferAccountType(sfAccount.name),
          sfAccount.currency ?? 'CAD',
          parseAmount(sfAccount.balance),
          sfAccount.id,
        ],
      );

      const accountId = acctRows[0]?.id;
      if (!accountId) continue;

      for (const txn of sfAccount.transactions) {
        const postedAt = new Date(txn.posted * 1000);
        const postedDate = postedAt.toISOString().split('T')[0];
        const amount = parseAmount(txn.amount);
        const descriptionClean = cleanDescription(txn.description);
        const fingerprint = fingerprintOf({
          accountId,
          postedDate,
          amount,
          description: txn.description,
        });

        try {
          const { rows: txnRows } = await db.query<{ id: string; category_source: string }>(
            `INSERT INTO transactions
               (account_id, posted_date, posted_at, amount, currency,
                description_raw, description_clean, pending,
                source, external_id, fingerprint, fingerprint_seq)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'simplefin', $9, $10, 0)
             ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
               SET amount      = EXCLUDED.amount,
                   pending     = EXCLUDED.pending,
                   posted_date = EXCLUDED.posted_date,
                   posted_at   = EXCLUDED.posted_at
             RETURNING id, category_source`,
            [
              accountId,
              postedDate,
              postedAt.toISOString(),
              amount,
              sfAccount.currency ?? 'CAD',
              txn.description,
              descriptionClean,
              txn.pending ?? false,
              txn.id,
              fingerprint,
            ],
          );
          totalAdded++;

          const inserted = txnRows[0];
          if (inserted && inserted.category_source !== 'manual') {
            try {
              await categorizeWithContext(
                {
                  id: inserted.id,
                  account_id: accountId,
                  description_raw: txn.description,
                  description_clean: descriptionClean,
                  merchant_name: null,
                  amount: String(amount),
                  posted_at: postedAt.toISOString(),
                },
                rules,
                leafCategories,
              );
            } catch (categorizeErr) {
              console.error('Categorization failed for transaction', inserted.id, (categorizeErr as Error).message);
            }
          }
        } catch {
          totalSkipped++;
        }
      }
    }

    // Update last synced timestamp
    await db.query(`UPDATE simplefin_access SET last_synced_at = NOW()`);

    const { matchedPairs } = await matchTransfers();

    return Response.json({
      ok: true,
      accounts: accounts.length,
      added: totalAdded,
      skipped: totalSkipped,
      transferPairsMatched: matchedPairs,
      warnings: errors,
    });
  } catch (err: any) {
    console.error('SimpleFIN sync error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
