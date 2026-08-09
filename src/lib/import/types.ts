/**
 * Shared types for the CSV import pipeline.
 *
 * The whole point of this layer is that everything downstream — categorization,
 * budget rollups, the dashboard — only ever sees a NormalizedTransaction. When
 * you add the Plaid adapter later it produces the same shape, and nothing else
 * in the app has to change.
 */

/** How a profile gets the signed amount out of a row. */
export type AmountStrategy =
  /** One column holds a signed number. */
  | { kind: 'signed'; column: string; /** true if the file uses +ve for spending */ invert?: boolean }
  /** Two columns: one for money out, one for money in. Only one is populated. */
  | { kind: 'debit_credit'; debitColumn: string; creditColumn: string }
  /** One magnitude column plus a separate column saying which direction. */
  | { kind: 'flagged'; column: string; flagColumn: string; debitValues: string[] };

export interface CsvProfile {
  id: string;
  label: string;
  /** Some Canadian bank exports ship with no header row at all. */
  hasHeader: boolean;
  /** Used for header-based detection. Lowercased, order-insensitive. */
  signatureHeaders?: string[];
  /** Column names, or "col0", "col1"... for headerless files. */
  dateColumn: string;
  /** Extra date column preferred when present (e.g. transaction vs posting date). */
  authorizedDateColumn?: string;
  /**
   * Accepted date layouts, tried in order. Uses explicit tokens rather than
   * Date.parse because "01/02/2026" is ambiguous and guessing wrong silently
   * shifts eleven months of data.
   */
  dateFormats: string[];
  /** One or more columns concatenated to form the description. */
  descriptionColumns: string[];
  amount: AmountStrategy;
  currency?: string;
  /** Rows to skip before the header (some exports prepend metadata). */
  skipLeadingRows?: number;
}

/** A single parsed row, before it is written to the database. */
export interface NormalizedTransaction {
  accountId: string;
  postedDate: string;          // ISO yyyy-mm-dd
  authorizedDate: string | null;
  /** Negative = money out. Positive = money in. See schema.sql. */
  amount: number;
  currency: string;
  descriptionRaw: string;
  descriptionClean: string;
  merchantName: string | null;
  pending: boolean;
  source: 'csv' | 'plaid' | 'manual';
  externalId: string | null;
  fingerprint: string;
  fingerprintSeq: number;
}

export interface RowError {
  rowIndex: number;
  raw: Record<string, string>;
  reason: string;
}

export interface NormalizeResult {
  transactions: NormalizedTransaction[];
  errors: RowError[];
  profileId: string;
}
