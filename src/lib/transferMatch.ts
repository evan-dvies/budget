import { randomUUID } from 'crypto';
import { db } from './db';

interface Candidate {
  id: string;
  account_id: string;
  account_type: string;
  posted_date: string;
  amount: string;
}

const MAX_DAY_GAP = 3;

/**
 * Detects transfers between the user's own accounts: an outflow from one
 * account and an inflow to another, equal in magnitude, within a few days
 * of each other. This is exactly what a credit card payment looks like
 * (large outflow from chequing, matching inflow to the card) and also
 * covers anything category_rules already flagged via sets_transfer (its
 * "ONLINE BANKING TRANSFER" / "PAYMENT - THANK YOU" patterns are the same
 * chequing-outflow / credit-inflow shape) -- no separate code path needed
 * for that case, it falls out of the same match.
 *
 * Requiring at least one leg to be a 'credit' account keeps this scoped to
 * the credit-card-payment case that's actually being asked for, rather
 * than matching any two coincidentally-equal amounts between arbitrary
 * accounts.
 *
 * Only considers transactions not already part of a transfer group, so
 * running this after every sync is safe -- already-matched pairs are
 * never touched again.
 */
export async function matchTransfers(): Promise<{ matchedPairs: number }> {
  const { rows } = await db.query<Candidate>(
    `SELECT t.id, t.account_id, a.type AS account_type, t.posted_date, t.amount
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.transfer_group_id IS NULL`,
  );

  const outflows = rows.filter((r) => Number(r.amount) < 0);
  const inflows = rows.filter((r) => Number(r.amount) > 0);

  const pairs: { outflowId: string; inflowId: string; dayGap: number }[] = [];

  for (const o of outflows) {
    const oAmount = Math.abs(Number(o.amount));
    const oTime = new Date(o.posted_date).getTime();
    for (const i of inflows) {
      if (o.account_id === i.account_id) continue;
      if (o.account_type !== 'credit' && i.account_type !== 'credit') continue;
      if (oAmount !== Number(i.amount)) continue;

      const dayGap = Math.abs(oTime - new Date(i.posted_date).getTime()) / 86_400_000;
      if (dayGap > MAX_DAY_GAP) continue;

      pairs.push({ outflowId: o.id, inflowId: i.id, dayGap });
    }
  }

  // Best (closest-dated) matches first, and each transaction can only be
  // claimed by one pair -- otherwise one $50 outflow with two coincidental
  // $50 inflow candidates would get double-matched.
  pairs.sort((a, b) => a.dayGap - b.dayGap);
  const claimed = new Set<string>();
  let matchedPairs = 0;

  for (const { outflowId, inflowId } of pairs) {
    if (claimed.has(outflowId) || claimed.has(inflowId)) continue;
    claimed.add(outflowId);
    claimed.add(inflowId);

    await db.query(
      `UPDATE transactions SET is_transfer = TRUE, transfer_group_id = $1 WHERE id = ANY($2)`,
      [randomUUID(), [outflowId, inflowId]],
    );
    matchedPairs++;
  }

  return { matchedPairs };
}
