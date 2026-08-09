import type { CsvProfile, NormalizedTransaction } from './types';
import { normalize, auditSignConvention } from './normalize';
import { filterNewRows } from './fingerprint';
import { validateProfile } from './profiles';

/**
 * Minimal query interface so this module isn't married to a specific driver.
 * Satisfied as-is by `pg`'s Pool/Client and by Neon's serverless client.
 */
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ImportSummary {
  batchId: string;
  profileId: string;
  rowsParsed: number;
  rowsInserted: number;
  rowsDuplicate: number;
  rowsFailed: number;
  /** Non-fatal things worth showing the user before they trust the numbers. */
  warnings: string[];
}

export interface ImportCsvOptions {
  db: Db;
  accountId: string;
  profile: CsvProfile;
  rows: Record<string, string>[];
  filename?: string;
  /** Abort instead of importing if the sign-convention audit looks wrong. */
  strictSignCheck?: boolean;
}

export async function importCsv(opts: ImportCsvOptions): Promise<ImportSummary> {
  const { db, accountId, profile, rows, filename, strictSignCheck = true } = opts;
  const warnings: string[] = [];

  if (rows.length === 0) {
    throw new Error('No rows to import.');
  }

  // Fail before touching the database if the profile can't address the columns.
  const columnProblems = validateProfile(profile, Object.keys(rows[0]));
  if (columnProblems.length > 0) {
    throw new Error(`Profile "${profile.id}" does not match this file:\n  ${columnProblems.join('\n  ')}`);
  }

  const { transactions, errors } = normalize({ accountId, profile, rows });

  if (transactions.length === 0) {
    throw new Error(
      `Every row failed to parse. First reason: ${errors[0]?.reason ?? 'unknown'}`,
    );
  }

  const audit = auditSignConvention(transactions);
  if (audit.warning) {
    if (strictSignCheck) {
      throw new Error(
        `${audit.warning}\nRe-run with strictSignCheck: false if this file really is all one direction.`,
      );
    }
    warnings.push(audit.warning);
  }

  // Count what's already stored for the fingerprints in this batch. Scoped to
  // the account so identical transactions in different accounts stay distinct.
  const fingerprints = [...new Set(transactions.map((t) => t.fingerprint))];
  const { rows: existing } = await db.query<{ fingerprint: string; count: string }>(
    `SELECT fingerprint, COUNT(*)::text AS count
       FROM transactions
      WHERE account_id = $1 AND fingerprint = ANY($2::text[])
      GROUP BY fingerprint`,
    [accountId, fingerprints],
  );

  const existingCounts = new Map(existing.map((r) => [r.fingerprint, Number(r.count)]));
  const { toInsert, duplicates } = filterNewRows(transactions, existingCounts);

  const { rows: batchRows } = await db.query<{ id: string }>(
    `INSERT INTO import_batches
       (account_id, source, filename, profile_id,
        rows_parsed, rows_inserted, rows_duplicate, rows_failed, error_log)
     VALUES ($1, 'csv', $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      accountId,
      filename ?? null,
      profile.id,
      rows.length,
      toInsert.length,
      duplicates.length,
      errors.length,
      JSON.stringify(errors.slice(0, 100)),
    ],
  );
  const batchId = batchRows[0].id;

  if (toInsert.length > 0) {
    await insertTransactions(db, toInsert, batchId);
  }

  if (errors.length > 0) {
    warnings.push(`${errors.length} row(s) could not be parsed. See import_batches.error_log.`);
  }

  return {
    batchId,
    profileId: profile.id,
    rowsParsed: rows.length,
    rowsInserted: toInsert.length,
    rowsDuplicate: duplicates.length,
    rowsFailed: errors.length,
    warnings,
  };
}

/**
 * Bulk insert in chunks. ON CONFLICT DO NOTHING is a safety net rather than the
 * primary dedup mechanism — if two imports race, the unique index on
 * (fingerprint, fingerprint_seq) is what actually guarantees correctness.
 */
async function insertTransactions(
  db: Db,
  txns: NormalizedTransaction[],
  batchId: string,
  chunkSize = 500,
): Promise<void> {
  const COLS = 13;

  for (let start = 0; start < txns.length; start += chunkSize) {
    const chunk = txns.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk.map((t, i) => {
      const base = i * COLS;
      values.push(
        t.accountId, t.postedDate, t.authorizedDate, t.amount, t.currency,
        t.descriptionRaw, t.descriptionClean, t.merchantName, t.pending,
        t.source, t.fingerprint, t.fingerprintSeq, batchId,
      );
      return `(${Array.from({ length: COLS }, (_, k) => `$${base + k + 1}`).join(', ')})`;
    });

    await db.query(
      `INSERT INTO transactions
         (account_id, posted_date, authorized_date, amount, currency,
          description_raw, description_clean, merchant_name, pending,
          source, fingerprint, fingerprint_seq, import_batch_id)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (fingerprint, fingerprint_seq) DO NOTHING`,
      values,
    );
  }
}
