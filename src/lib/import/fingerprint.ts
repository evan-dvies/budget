import { createHash } from 'node:crypto';

/**
 * Deduplication for sources that have no stable transaction id.
 *
 * Plaid gives every transaction a permanent `transaction_id`, so dedup there is
 * trivial. CSV gives you nothing, and you WILL re-import overlapping date ranges
 * — every bank export is "last 90 days" and you'll pull it monthly.
 *
 * The naive fix (hash date + amount + description) breaks on a real and common
 * case: two identical purchases on the same day. Two $4.50 coffees on the same
 * Tuesday at the same shop are two transactions, and collapsing them into one
 * quietly understates your spending forever.
 *
 * So the key is (fingerprint, fingerprintSeq). Rows sharing a fingerprint get
 * sequence 0, 1, 2... within the file. On import you compare the count of each
 * fingerprint in the file against the count already stored, and insert only the
 * surplus. Re-importing the same file inserts nothing; importing a file with a
 * third coffee inserts exactly one row.
 */

/**
 * Collapses a bank description to its stable core so that cosmetic changes
 * between exports don't produce a false "new" transaction.
 */
export function canonicalizeForFingerprint(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')  // punctuation varies between exports
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprintOf(input: {
  accountId: string;
  postedDate: string;   // yyyy-mm-dd
  amount: number;
  description: string;
}): string {
  const parts = [
    input.accountId,
    input.postedDate,
    input.amount.toFixed(2),
    canonicalizeForFingerprint(input.description),
  ];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

/**
 * Assigns 0-based sequence numbers within a batch to rows sharing a fingerprint.
 * Mutates nothing; returns the sequence for each item in input order.
 */
export function assignSequences(fingerprints: string[]): number[] {
  const counts = new Map<string, number>();
  return fingerprints.map((fp) => {
    const n = counts.get(fp) ?? 0;
    counts.set(fp, n + 1);
    return n;
  });
}

/**
 * Given the fingerprint counts already in the database, works out which rows of
 * an incoming batch are genuinely new.
 *
 * `existingCounts` should come from:
 *   SELECT fingerprint, COUNT(*) FROM transactions
 *   WHERE account_id = $1 AND fingerprint = ANY($2) GROUP BY fingerprint
 */
export function filterNewRows<T extends { fingerprint: string; fingerprintSeq: number }>(
  batch: T[],
  existingCounts: Map<string, number>,
): { toInsert: T[]; duplicates: T[] } {
  const toInsert: T[] = [];
  const duplicates: T[] = [];
  for (const row of batch) {
    const alreadyStored = existingCounts.get(row.fingerprint) ?? 0;
    if (row.fingerprintSeq < alreadyStored) {
      duplicates.push(row);
    } else {
      toInsert.push(row);
    }
  }
  return { toInsert, duplicates };
}
