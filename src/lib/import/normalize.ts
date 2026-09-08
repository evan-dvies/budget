import type {
  CsvProfile,
  NormalizeResult,
  NormalizedTransaction,
  RowError,
} from './types';
import { assignSequences, fingerprintOf } from './fingerprint';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parses a date against an explicit format token string.
 *
 * Deliberately does NOT fall back to `new Date(str)`. Date.parse treats
 * "01/02/2026" as January 2nd, but half the Canadian bank exports in existence
 * mean February 1st. A silent eleven-month shift across a year of data is much
 * worse than a loud parse failure, so unknown layouts throw.
 *
 * Supported tokens: YYYY, YY, MM, M, MMM, DD, D
 */
export function parseDate(value: string, formats: string[]): string | null {
  const raw = value.trim();
  if (!raw) return null;

  for (const fmt of formats) {
    const parsed = tryFormat(raw, fmt);
    if (parsed) return parsed;
  }
  return null;
}

function tryFormat(value: string, format: string): string | null {
  // Build a regex from the format, capturing each token in order.
  const tokens: string[] = [];
  const pattern = format.replace(/YYYY|YY|MMM|MM|M|DD|D/g, (token) => {
    tokens.push(token);
    switch (token) {
      case 'YYYY': return '(\\d{4})';
      case 'YY':   return '(\\d{2})';
      case 'MMM':  return '([A-Za-z]{3})';
      case 'MM':   return '(\\d{2})';
      case 'M':    return '(\\d{1,2})';
      case 'DD':   return '(\\d{2})';
      case 'D':    return '(\\d{1,2})';
      default:     return token;
    }
  });

  const match = new RegExp(`^${pattern}$`).exec(value);
  if (!match) return null;

  let year = 0, month = 0, day = 0;
  tokens.forEach((token, i) => {
    const captured = match[i + 1];
    switch (token) {
      case 'YYYY': year = Number(captured); break;
      case 'YY':   year = 2000 + Number(captured); break;
      case 'MMM':  month = MONTHS[captured.toLowerCase()] ?? 0; break;
      case 'MM':
      case 'M':    month = Number(captured); break;
      case 'DD':
      case 'D':    day = Number(captured); break;
    }
  });

  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject impossible calendar dates (Feb 30) rather than letting JS roll over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * Parses a monetary string into a number.
 * Handles currency symbols, thousands separators, and accounting-style
 * parentheses for negatives — "(1,234.56)" means -1234.56.
 */
export function parseAmount(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;

  const isParenNegative = /^\(.*\)$/.test(raw);
  const cleaned = raw
    .replace(/[()]/g, '')
    .replace(/[$\s]/g, '')
    .replace(/,/g, '');

  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;

  const signed = isParenNegative ? -Math.abs(n) : n;
  return Math.round(signed * 100) / 100;
}

/**
 * Resolves the profile's amount strategy into a signed number using the
 * app-wide convention: negative = money out, positive = money in.
 */
function extractAmount(row: Record<string, string>, profile: CsvProfile): number | null {
  const strat = profile.amount;

  if (strat.kind === 'signed') {
    const n = parseAmount(row[strat.column] ?? '');
    if (n === null) return null;
    return strat.invert ? -n : n;
  }

  if (strat.kind === 'debit_credit') {
    const debit = parseAmount(row[strat.debitColumn] ?? '');
    const credit = parseAmount(row[strat.creditColumn] ?? '');
    // Exactly one side should be populated. Both populated is a malformed row.
    if (debit !== null && credit !== null && debit !== 0 && credit !== 0) return null;
    if (debit !== null && debit !== 0) return -Math.abs(debit);
    if (credit !== null && credit !== 0) return Math.abs(credit);
    return null;
  }

  // strat.kind === 'flagged'
  const magnitude = parseAmount(row[strat.column] ?? '');
  if (magnitude === null) return null;
  const flag = (row[strat.flagColumn] ?? '').trim().toUpperCase();
  const isDebit = strat.debitValues.some((v) => v.toUpperCase() === flag);
  return isDebit ? -Math.abs(magnitude) : Math.abs(magnitude);
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

/**
 * Payment-processor and channel prefixes that carry no information about who
 * you actually paid. Stripping them is what turns "SQ *TIM HORTONS #4471" into
 * something a categorization rule can match on.
 */
const NOISE_PREFIXES = [
  'POS PURCHASE', 'POINT OF SALE PURCHASE', 'POS ',
  'INTERAC PURCHASE', 'IDP PURCHASE', 'RETAIL PURCHASE',
  'VISA DEBIT PURCHASE', 'DEBIT PURCHASE', 'PREAUTHORIZED DEBIT',
  'SQ *', 'SQ*', 'TST*', 'TST *', 'SP ', 'PAYPAL *', 'PP*',
  'AMZN MKTP', 'WWW.', 'HTTP://', 'HTTPS://',
];

const PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/**
 * Produces the string that categorization rules match against: uppercase,
 * de-noised, with store numbers and trailing location metadata removed.
 */
export function cleanDescription(raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, ' ').trim();

  for (const prefix of NOISE_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
    }
  }

  s = s
    .replace(/#\s*\d+/g, ' ')            // store numbers: "#4471"
    .replace(/\b\d{6,}\b/g, ' ')         // long reference numbers
    .replace(/\bREF\s*[:#]?\s*\S+/g, ' ')
    .replace(/[*_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Drop a trailing province code, and a trailing city if one precedes it.
  const words = s.split(' ');
  if (words.length > 2 && PROVINCE_CODES.has(words[words.length - 1])) {
    words.pop();
    if (words.length > 1) words.pop();   // the city
    s = words.join(' ').trim();
  }

  s = s.replace(/^[\s\-,.]+|[\s\-,.]+$/g, '').trim();

  // Noise prefixes are meant to strip a boilerplate lead-in before a merchant
  // name, not the whole description. If nothing's left (e.g. SimpleFIN's bare
  // "Interac purchase" with no merchant detail), fall back to the original.
  if (!s) return raw.toUpperCase().replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Brands that should stay upper-case when title-casing a merchant name.
 * An explicit list beats a "short words are acronyms" heuristic, which turns
 * TIM HORTONS into "TIM Hortons". Add to it as you spot cases in your own data.
 */
const KEEP_UPPERCASE = new Set([
  'IGA', 'KFC', 'A&W', 'IKEA', 'MEC', 'LCBO', 'SAQ', 'PC', 'ATM',
  'BMO', 'TD', 'RBC', 'CIBC', 'ATB', 'GST', 'HST', 'BC', 'AB', 'UPS', 'DHL',
]);

/**
 * Best guess at the business name, for display. Takes the leading words of the
 * cleaned description and title-cases them. Intentionally simple — Plaid's
 * `merchant_name` supersedes this once you wire up the API adapter.
 */
export function guessMerchant(clean: string): string | null {
  if (!clean) return null;
  const words = clean.split(' ').filter(Boolean).slice(0, 4);
  if (words.length === 0) return null;
  return words
    .map((w) => (KEEP_UPPERCASE.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface NormalizeOptions {
  accountId: string;
  profile: CsvProfile;
  /** Rows as objects. Headerless files should use keys "col0", "col1", ... */
  rows: Record<string, string>[];
}

export function normalize(opts: NormalizeOptions): NormalizeResult {
  const { accountId, profile, rows } = opts;
  const currency = profile.currency ?? 'CAD';
  const errors: RowError[] = [];
  const staged: Omit<NormalizedTransaction, 'fingerprintSeq'>[] = [];

  rows.forEach((row, rowIndex) => {
    const dateValue = row[profile.dateColumn] ?? '';
    const postedDate = parseDate(dateValue, profile.dateFormats);
    if (!postedDate) {
      errors.push({
        rowIndex,
        raw: row,
        reason: `Could not parse date "${dateValue}" using formats ${profile.dateFormats.join(', ')}`,
      });
      return;
    }

    const amount = extractAmount(row, profile);
    if (amount === null) {
      errors.push({ rowIndex, raw: row, reason: 'Could not resolve a signed amount' });
      return;
    }
    // A zero-value row is almost always a header artifact or a balance line.
    if (amount === 0) {
      errors.push({ rowIndex, raw: row, reason: 'Zero amount — skipped' });
      return;
    }

    const descriptionRaw = profile.descriptionColumns
      .map((c) => (row[c] ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!descriptionRaw) {
      errors.push({ rowIndex, raw: row, reason: 'Empty description' });
      return;
    }

    const authorizedDate = profile.authorizedDateColumn
      ? parseDate(row[profile.authorizedDateColumn] ?? '', profile.dateFormats)
      : null;

    const descriptionClean = cleanDescription(descriptionRaw);

    staged.push({
      accountId,
      postedDate,
      authorizedDate,
      amount,
      currency,
      descriptionRaw,
      descriptionClean,
      merchantName: guessMerchant(descriptionClean),
      pending: false,          // CSV exports only contain posted transactions
      source: 'csv',
      externalId: null,
      fingerprint: fingerprintOf({
        accountId,
        postedDate,
        amount,
        description: descriptionRaw,
      }),
    });
  });

  const seqs = assignSequences(staged.map((t) => t.fingerprint));
  const transactions: NormalizedTransaction[] = staged.map((t, i) => ({
    ...t,
    fingerprintSeq: seqs[i],
  }));

  return { transactions, errors, profileId: profile.id };
}

/**
 * Sanity check to run after a first import, before trusting the data.
 *
 * The single most common CSV import failure is an inverted sign convention, and
 * it does not throw — it just makes your dashboard cheerfully report that you
 * earned $4,200 at the grocery store. If almost every row points the same way,
 * the profile is probably wrong.
 */
export function auditSignConvention(transactions: NormalizedTransaction[]): {
  inflows: number;
  outflows: number;
  warning: string | null;
} {
  const inflows = transactions.filter((t) => t.amount > 0).length;
  const outflows = transactions.filter((t) => t.amount < 0).length;
  const total = inflows + outflows;

  let warning: string | null = null;
  if (total >= 10) {
    if (outflows === 0) {
      warning = 'No outflows found. The amount sign is almost certainly inverted for this profile.';
    } else if (inflows / total > 0.9) {
      warning = `${inflows} of ${total} rows are inflows. Check the profile's sign convention.`;
    }
  }
  return { inflows, outflows, warning };
}
