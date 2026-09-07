/**
 * SimpleFIN Bridge client.
 *
 * The flow is:
 * 1. User generates a setup token on beta-bridge.simplefin.org
 * 2. We POST to that token URL once to claim a permanent access URL
 * 3. We store the access URL in the database (encrypted)
 * 4. Every sync we GET the access URL with a date range to pull transactions
 *
 * Docs: https://beta-bridge.simplefin.org/info/developers
 */

export interface SFAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  'balance-date': number;
  transactions: SFTransaction[];
  org: { name: string };
}

export interface SFTransaction {
  id: string;
  posted: number;       // Unix timestamp
  amount: string;       // Signed decimal string, negative = money out
  description: string;
  pending?: boolean;
}

export interface SFAccountSet {
  accounts: SFAccount[];
  errors: string[];
}

/**
 * Exchanges a one-time setup token for a permanent access URL.
 * Call this exactly once per token — the token is consumed on first use.
 */
export async function claimAccessUrl(setupToken: string): Promise<string> {
  // The setup token is a base64-encoded URL
  const claimUrl = Buffer.from(setupToken, 'base64').toString('utf8');

  const res = await fetch(claimUrl, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Failed to claim SimpleFIN access URL: ${res.status} ${await res.text()}`);
  }

  const accessUrl = await res.text();
  if (!accessUrl.startsWith('https://')) {
    throw new Error(`Unexpected access URL format: ${accessUrl}`);
  }

  return accessUrl.trim();
}

/**
 * Fetches accounts and transactions from SimpleFIN.
 *
 * startDate / endDate are ISO date strings (yyyy-mm-dd).
 * SimpleFIN returns transactions within that range.
 */
export async function fetchAccounts(
  accessUrl: string,
  startDate: string,
  endDate: string,
): Promise<SFAccountSet> {
  const url = new URL(`${accessUrl}/accounts`);
  url.searchParams.set('start-date', String(Math.floor(new Date(startDate).getTime() / 1000)));
  url.searchParams.set('end-date', String(Math.floor(new Date(endDate).getTime() / 1000)));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`SimpleFIN fetch failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<SFAccountSet>;
}

/**
 * Converts a SimpleFIN signed amount string to our convention:
 * negative = money out, positive = money in.
 * SimpleFIN already uses this convention, so this is just parseFloat with rounding.
 */
export function parseAmount(amountStr: string): number {
  const n = parseFloat(amountStr);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${amountStr}`);
  return Math.round(n * 100) / 100;
}
