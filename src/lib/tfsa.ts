import { db } from './db';

/**
 * CRA's published TFSA annual dollar limit by year. Update this each fall
 * when CRA announces next year's limit (usually indexed to inflation and
 * rounded to the nearest $500).
 * https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributions.html
 */
export const TFSA_ANNUAL_LIMITS: Record<number, number> = {
  2009: 5000, 2010: 5000, 2011: 5000, 2012: 5000,
  2013: 5500, 2014: 5500,
  2015: 10000,
  2016: 5500, 2017: 5500, 2018: 5500,
  2019: 6000, 2020: 6000, 2021: 6000, 2022: 6000,
  2023: 6500,
  2024: 7000, 2025: 7000, 2026: 7000,
};

// Used for any year past the table above, so the tracker degrades gracefully
// instead of throwing once this file goes stale -- but the number is a
// guess, so callers should flag it as unverified.
const FALLBACK_ANNUAL_LIMIT = 7000;

function limitForYear(year: number): { amount: number; verified: boolean } {
  const known = TFSA_ANNUAL_LIMITS[year];
  return known !== undefined ? { amount: known, verified: true } : { amount: FALLBACK_ANNUAL_LIMIT, verified: false };
}

export interface TfsaStatus {
  hasRoomSet: boolean;
  asOfDate: string | null;
  asOfAmount: number | null;
  accruedSinceAsOf: number;
  contributionsSinceAsOf: number;
  withdrawalsRestoredSinceAsOf: number;
  pendingRestoration: number;
  currentRoom: number | null;
  isOverContributed: boolean;
  unverifiedLimitYears: number[];
}

export async function setTfsaRoom(asOfDate: string, amount: number): Promise<void> {
  await db.query(`DELETE FROM tfsa_room`);
  await db.query(
    `INSERT INTO tfsa_room (as_of_date, room_amount) VALUES ($1, $2)`,
    [asOfDate, amount],
  );
}

export async function getTfsaStatus(): Promise<TfsaStatus> {
  const { rows } = await db.query<{ as_of_date: string; room_amount: string }>(
    `SELECT as_of_date, room_amount FROM tfsa_room LIMIT 1`,
  );
  const setting = rows[0];

  if (!setting) {
    return {
      hasRoomSet: false,
      asOfDate: null,
      asOfAmount: null,
      accruedSinceAsOf: 0,
      contributionsSinceAsOf: 0,
      withdrawalsRestoredSinceAsOf: 0,
      pendingRestoration: 0,
      currentRoom: null,
      isOverContributed: false,
      unverifiedLimitYears: [],
    };
  }

  const asOfDate = new Date(setting.as_of_date);
  const asOfYear = asOfDate.getUTCFullYear();
  const asOfAmount = Number(setting.room_amount);
  const currentYear = new Date().getUTCFullYear();

  // Every Jan 1 since the room was last checked adds that year's limit,
  // regardless of activity -- this happens whether or not you contribute.
  let accruedSinceAsOf = 0;
  const unverifiedLimitYears: number[] = [];
  for (let y = asOfYear + 1; y <= currentYear; y++) {
    const { amount, verified } = limitForYear(y);
    accruedSinceAsOf += amount;
    if (!verified) unverifiedLimitYears.push(y);
  }

  // Every dollar that moved into or out of the TFSA account counts here --
  // including interest, since a plain deposit and interest credit look
  // identical without a real transfer match on both legs (matchTransfers
  // only pairs legs where one side is a credit-card account, so a
  // chequing-to-TFSA transfer is never flagged is_transfer). Treating every
  // inflow as a contribution is the conservative reading: it can only ever
  // overstate usage and warn early, never miss a real over-contribution.
  const { rows: acctRows } = await db.query<{ id: string }>(
    `SELECT id FROM accounts WHERE name ILIKE '%tfsa%' AND is_active = TRUE LIMIT 1`,
  );
  const tfsaAccountId = acctRows[0]?.id;

  let contributionsSinceAsOf = 0;
  let withdrawalsRestoredSinceAsOf = 0;
  let pendingRestoration = 0;

  if (tfsaAccountId) {
    const { rows: txns } = await db.query<{ posted_date: string; amount: string }>(
      `SELECT posted_date, amount FROM transactions
       WHERE account_id = $1 AND posted_date > $2::date AND pending = FALSE
       ORDER BY posted_date`,
      [tfsaAccountId, setting.as_of_date],
    );

    for (const t of txns) {
      const amount = Number(t.amount);
      const year = new Date(t.posted_date).getUTCFullYear();
      if (amount > 0) {
        contributionsSinceAsOf += amount;
      } else if (amount < 0) {
        // A withdrawal only restores room on Jan 1 of the year AFTER it
        // happened -- one made this year is real usage until then.
        if (year < currentYear) {
          withdrawalsRestoredSinceAsOf += -amount;
        } else {
          pendingRestoration += -amount;
        }
      }
    }
  }

  const currentRoom = asOfAmount + accruedSinceAsOf - contributionsSinceAsOf + withdrawalsRestoredSinceAsOf;

  return {
    hasRoomSet: true,
    asOfDate: setting.as_of_date,
    asOfAmount,
    accruedSinceAsOf,
    contributionsSinceAsOf,
    withdrawalsRestoredSinceAsOf,
    pendingRestoration,
    currentRoom: Math.round(currentRoom * 100) / 100,
    isOverContributed: currentRoom < 0,
    unverifiedLimitYears,
  };
}
