import { db } from '@/lib/db';
import { fetchAccounts, parseAmount } from '@/lib/simplefin';
import { cleanDescription } from '@/lib/import/normalize';
import { fingerprintOf } from '@/lib/import/fingerprint';
import { categorizeAll } from '@/lib/categorize';
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

    // SimpleFIN reports connection problems (e.g. "Auth required" after a
    // bank forces re-login) in `errors` while still returning 200 with
    // whatever stale data it has cached -- the sync looks "successful" with
    // nothing telling you the data stopped updating. Surface that distinctly
    // so the UI can point you at where to fix it.
    const authErrorPattern = /auth|expired|credential|reauthenticat|re-authenticat|attention|login/i;
    const authErrors = errors.filter((e) => authErrorPattern.test(e));
    const needsReauth = authErrors.length > 0;

    let totalAdded = 0;
    let totalSkipped = 0;
    const skippedDetails: { account: string; description: string; error: string }[] = [];

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

      // Rows already stored under one of this batch's external_ids keep their
      // existing fingerprint_seq (irrelevant to the UPDATE path below, but
      // needed so we don't hand out a seq some other row already owns).
      // Everything else is a genuinely new row, and two distinct SimpleFIN
      // transactions can share a fingerprint (same account/date/amount/
      // description -- e.g. two identical transit taps) despite having
      // different external_ids, so each new one needs the next free seq for
      // that fingerprint rather than the hardcoded 0 this used to insert.
      const externalIds = sfAccount.transactions.map((t) => t.id);
      const { rows: existingRows } = await db.query<{ external_id: string; fingerprint_seq: number }>(
        `SELECT external_id, fingerprint_seq FROM transactions
         WHERE account_id = $1 AND external_id = ANY($2)`,
        [accountId, externalIds],
      );
      const existingSeqByExternalId = new Map(existingRows.map((r) => [r.external_id, r.fingerprint_seq]));
      const nextSeqByFingerprint = new Map<string, number>();

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

        let fingerprintSeq = existingSeqByExternalId.get(txn.id);
        if (fingerprintSeq === undefined) {
          if (!nextSeqByFingerprint.has(fingerprint)) {
            const { rows: countRows } = await db.query<{ cnt: string }>(
              `SELECT COUNT(*) AS cnt FROM transactions WHERE fingerprint = $1`,
              [fingerprint],
            );
            nextSeqByFingerprint.set(fingerprint, Number(countRows[0].cnt));
          }
          fingerprintSeq = nextSeqByFingerprint.get(fingerprint)!;
          nextSeqByFingerprint.set(fingerprint, fingerprintSeq + 1);
        }

        const merchantName = txn.payee?.trim() || null;

        try {
          await db.query(
            `INSERT INTO transactions
               (account_id, posted_date, posted_at, amount, currency,
                description_raw, description_clean, merchant_name, pending,
                source, external_id, fingerprint, fingerprint_seq)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'simplefin', $10, $11, $12)
             ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
               SET amount        = EXCLUDED.amount,
                   pending       = EXCLUDED.pending,
                   posted_date   = EXCLUDED.posted_date,
                   posted_at     = EXCLUDED.posted_at,
                   merchant_name = EXCLUDED.merchant_name`,
            [
              accountId,
              postedDate,
              postedAt.toISOString(),
              amount,
              sfAccount.currency ?? 'CAD',
              txn.description,
              descriptionClean,
              merchantName,
              txn.pending ?? false,
              txn.id,
              fingerprint,
              fingerprintSeq,
            ],
          );
          totalAdded++;
        } catch (err: any) {
          totalSkipped++;
          console.error(
            `SimpleFIN sync: skipped txn "${txn.description}" on ${sfAccount.name}:`,
            err.message,
          );
          if (skippedDetails.length < 20) {
            skippedDetails.push({
              account: sfAccount.name,
              description: txn.description,
              error: err.message ?? String(err),
            });
          }
        }
      }
    }

    // Update last synced timestamp
    await db.query(`UPDATE simplefin_access SET last_synced_at = NOW()`);

    // Re-categorize everything (not just what this sync touched) so a rule
    // added or changed today applies to every past transaction on the very
    // next sync -- SimpleFIN only re-fetches a 30-day window, so anything
    // older than that would otherwise never see a rule update without a
    // manual backfill.
    const { processed: recategorized } = await categorizeAll();
    const { matchedPairs } = await matchTransfers();

    return Response.json({
      ok: true,
      accounts: accounts.length,
      added: totalAdded,
      skipped: totalSkipped,
      skippedDetails,
      recategorized,
      transferPairsMatched: matchedPairs,
      warnings: errors,
      needsReauth,
      reauthMessage: needsReauth ? authErrors[0] : null,
      reauthUrl: needsReauth ? 'https://beta-bridge.simplefin.org' : null,
    });
  } catch (err: any) {
    console.error('SimpleFIN sync error:', err.stack ?? err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
