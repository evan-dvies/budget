import type { CsvProfile } from './types';

/**
 * CSV profiles for Canadian bank exports.
 *
 * IMPORTANT: verify each profile against a real export before trusting it.
 * Bank CSV layouts change without notice, differ between personal and business
 * accounts, and sometimes differ between the "download" and "export" buttons in
 * the same online banking UI. Treat these as starting points, not gospel — the
 * `validateProfile` helper below is there so a wrong profile fails loudly on
 * import instead of quietly inverting your grocery budget.
 *
 * To add your own: open the CSV in a text editor, copy the header row (or the
 * first data row if there is no header), and add an entry here.
 */
export const PROFILES: CsvProfile[] = [
  {
    id: 'rbc',
    label: 'RBC Royal Bank',
    hasHeader: true,
    signatureHeaders: ['account type', 'transaction date', 'cad$'],
    dateColumn: 'Transaction Date',
    dateFormats: ['M/D/YYYY', 'YYYY-MM-DD'],
    descriptionColumns: ['Description 1', 'Description 2'],
    amount: { kind: 'signed', column: 'CAD$' },
    currency: 'CAD',
  },
  {
    id: 'td',
    label: 'TD Canada Trust',
    // TD's chequing export historically ships headerless:
    // date, description, debit, credit, balance
    hasHeader: false,
    dateColumn: 'col0',
    dateFormats: ['MM/DD/YYYY', 'M/D/YYYY'],
    descriptionColumns: ['col1'],
    amount: { kind: 'debit_credit', debitColumn: 'col2', creditColumn: 'col3' },
    currency: 'CAD',
  },
  {
    id: 'cibc',
    label: 'CIBC',
    hasHeader: false,
    dateColumn: 'col0',
    dateFormats: ['YYYY-MM-DD'],
    descriptionColumns: ['col1'],
    amount: { kind: 'debit_credit', debitColumn: 'col2', creditColumn: 'col3' },
    currency: 'CAD',
  },
  {
    id: 'scotiabank',
    label: 'Scotiabank',
    hasHeader: false,
    dateColumn: 'col0',
    dateFormats: ['M/D/YYYY', 'YYYY-MM-DD'],
    descriptionColumns: ['col2'],
    amount: { kind: 'signed', column: 'col1' },
    currency: 'CAD',
  },
  {
    id: 'bmo',
    label: 'BMO',
    hasHeader: true,
    signatureHeaders: ['first bank card', 'transaction type', 'date posted'],
    dateColumn: 'Date Posted',
    dateFormats: ['YYYYMMDD', 'YYYY-MM-DD'],
    descriptionColumns: ['Description'],
    amount: { kind: 'signed', column: 'Transaction Amount' },
    currency: 'CAD',
  },
  {
    id: 'tangerine',
    label: 'Tangerine',
    hasHeader: true,
    signatureHeaders: ['date', 'transaction', 'name', 'memo', 'amount'],
    dateColumn: 'Date',
    dateFormats: ['M/D/YYYY', 'YYYY-MM-DD'],
    descriptionColumns: ['Name', 'Memo'],
    amount: { kind: 'signed', column: 'Amount' },
    currency: 'CAD',
  },
  {
    id: 'atb',
    label: 'ATB Financial',
    hasHeader: true,
    signatureHeaders: ['date', 'description', 'withdrawal', 'deposit'],
    dateColumn: 'Date',
    dateFormats: ['YYYY-MM-DD', 'M/D/YYYY'],
    descriptionColumns: ['Description'],
    amount: { kind: 'debit_credit', debitColumn: 'Withdrawal', creditColumn: 'Deposit' },
    currency: 'CAD',
  },
  {
    id: 'amex_ca',
    label: 'American Express Canada',
    hasHeader: true,
    signatureHeaders: ['date', 'description', 'amount'],
    dateColumn: 'Date',
    dateFormats: ['DD MMM YYYY', 'M/D/YYYY', 'YYYY-MM-DD'],
    descriptionColumns: ['Description'],
    // Card issuers usually export charges as POSITIVE. Inverting here keeps the
    // app-wide convention (negative = money out) intact.
    amount: { kind: 'signed', column: 'Amount', invert: true },
    currency: 'CAD',
  },
  {
    id: 'generic_signed',
    label: 'Generic (date, description, signed amount)',
    hasHeader: true,
    signatureHeaders: ['date', 'description', 'amount'],
    dateColumn: 'Date',
    dateFormats: ['YYYY-MM-DD', 'M/D/YYYY', 'DD/MM/YYYY'],
    descriptionColumns: ['Description'],
    amount: { kind: 'signed', column: 'Amount' },
    currency: 'CAD',
  },
];

export function getProfile(id: string): CsvProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

/**
 * Best-effort profile detection from the header row.
 *
 * Deliberately conservative: it only matches when every signature header is
 * present. A wrong auto-detection is far more expensive than asking the user
 * to pick from a dropdown, because a mis-parsed date format can shift an entire
 * year of transactions without throwing a single error.
 */
export function detectProfile(headers: string[]): CsvProfile | null {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const candidates = PROFILES.filter((p) => {
    if (!p.hasHeader || !p.signatureHeaders) return false;
    return p.signatureHeaders.every((sig) => normalized.includes(sig));
  });
  if (candidates.length === 0) return null;
  // Prefer the most specific match (most signature headers).
  candidates.sort((a, b) => (b.signatureHeaders!.length - a.signatureHeaders!.length));
  return candidates[0];
}

/**
 * Checks that a profile can actually address every column it references.
 * Run this before importing so a mismatched profile fails on row 0 rather than
 * producing 400 rows of nulls.
 */
export function validateProfile(profile: CsvProfile, availableColumns: string[]): string[] {
  const problems: string[] = [];
  const has = (col: string) => availableColumns.includes(col);

  if (!has(profile.dateColumn)) {
    problems.push(`Date column "${profile.dateColumn}" not found.`);
  }
  for (const col of profile.descriptionColumns) {
    if (!has(col)) problems.push(`Description column "${col}" not found.`);
  }
  const a = profile.amount;
  if (a.kind === 'signed' && !has(a.column)) {
    problems.push(`Amount column "${a.column}" not found.`);
  }
  if (a.kind === 'debit_credit') {
    if (!has(a.debitColumn)) problems.push(`Debit column "${a.debitColumn}" not found.`);
    if (!has(a.creditColumn)) problems.push(`Credit column "${a.creditColumn}" not found.`);
  }
  if (a.kind === 'flagged') {
    if (!has(a.column)) problems.push(`Amount column "${a.column}" not found.`);
    if (!has(a.flagColumn)) problems.push(`Flag column "${a.flagColumn}" not found.`);
  }
  if (problems.length > 0) {
    problems.push(`Available columns: ${availableColumns.join(', ')}`);
  }
  return problems;
}
