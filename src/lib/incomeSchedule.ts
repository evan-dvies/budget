import { db } from './db';

export interface NextPayday {
  amount: number;
  date: string; // "YYYY-MM-DD"
  daysUntil: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Projects the next payday from the stored anchor date -- the anchor is one
 * real, confirmed payday, and every payday since is exactly 14 days apart,
 * so the next one is just the anchor plus however many 14-day steps have
 * elapsed, rounded up to the next step.
 */
export async function getNextPayday(): Promise<NextPayday | null> {
  const { rows } = await db.query<{ amount: string; frequency: string; anchor_date: string }>(
    `SELECT amount, frequency, anchor_date FROM income_schedule LIMIT 1`,
  );
  const schedule = rows[0];
  if (!schedule || schedule.frequency !== 'biweekly') return null;

  const anchor = new Date(schedule.anchor_date);
  const today = new Date(new Date().toISOString().split('T')[0]); // midnight UTC today, date-only

  const elapsedDays = Math.floor((today.getTime() - anchor.getTime()) / DAY_MS);
  const stepsPassed = Math.floor(elapsedDays / 14);
  // If today IS a payday, that counts as "next" (daysUntil: 0) rather than
  // jumping ahead to the following one.
  const nextStep = elapsedDays % 14 === 0 && elapsedDays >= 0 ? stepsPassed : stepsPassed + 1;
  const nextDate = new Date(anchor.getTime() + nextStep * 14 * DAY_MS);

  return {
    amount: Number(schedule.amount),
    date: nextDate.toISOString().split('T')[0],
    daysUntil: Math.round((nextDate.getTime() - today.getTime()) / DAY_MS),
  };
}
