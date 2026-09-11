import { db } from './db';

const PRICE_CREEP_THRESHOLD = 0.10; // KeepMySubs' own default -- a 10%+ jump gets flagged

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' | 'irregular';

interface Occurrence {
  date: string;
  amount: number;
}

export interface SubscriptionEntry {
  merchant: string;
  source: 'category' | 'pattern';
  cadence: Cadence;
  occurrences: Occurrence[];
  lastAmount: number;
  previousAmount: number | null;
  priceIncreasePct: number | null;
  isPriceCreep: boolean;
  estimatedMonthly: number;
}

const CADENCE_MONTHLY_MULTIPLIER: Record<Cadence, number> = {
  weekly: 30 / 7,
  biweekly: 30 / 14,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  irregular: 1,
};

/** Median of a sorted-or-not array of numbers. */
function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function detectCadence(dates: string[]): Cadence {
  if (dates.length < 2) return 'irregular';
  const sorted = [...dates].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 86_400_000);
  }
  const g = median(gaps);
  if (g >= 5 && g <= 9) return 'weekly';
  if (g >= 12 && g <= 16) return 'biweekly';
  if (g >= 26 && g <= 35) return 'monthly';
  if (g >= 80 && g <= 100) return 'quarterly';
  if (g >= 350 && g <= 380) return 'annual';
  return 'irregular';
}

function buildEntry(merchant: string, source: 'category' | 'pattern', occurrences: Occurrence[]): SubscriptionEntry {
  const sorted = [...occurrences].sort((a, b) => a.date.localeCompare(b.date));
  const cadence = detectCadence(sorted.map((o) => o.date));
  const lastAmount = sorted[sorted.length - 1].amount;
  const previousAmount = sorted.length >= 2 ? sorted[sorted.length - 2].amount : null;
  const priceIncreasePct = previousAmount && previousAmount > 0
    ? Math.round(((lastAmount - previousAmount) / previousAmount) * 1000) / 10
    : null;

  return {
    merchant,
    source,
    cadence,
    occurrences: sorted,
    lastAmount,
    previousAmount,
    priceIncreasePct,
    isPriceCreep: priceIncreasePct !== null && priceIncreasePct / 100 >= PRICE_CREEP_THRESHOLD,
    estimatedMonthly: Math.round(lastAmount * CADENCE_MONTHLY_MULTIPLIER[cadence] * 100) / 100,
  };
}

export async function detectSubscriptions(): Promise<SubscriptionEntry[]> {
  // Signal 1: anything already categorized as a subscription -- listed
  // regardless of how many times it's been seen, since the categorizer
  // already made the call that it's a subscription.
  const { rows: categorized } = await db.query<{ merchant_name: string; posted_date: string; amount: string }>(
    `SELECT t.merchant_name, t.posted_date, -t.amount AS amount
     FROM budgetable_transactions t
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE t.amount < 0 AND t.merchant_name IS NOT NULL
       AND (c.name = 'Subscriptions' OR p.name = 'Subscriptions')
     ORDER BY t.merchant_name, t.posted_date`,
  );

  const byMerchantCategorized = new Map<string, Occurrence[]>();
  for (const r of categorized) {
    const list = byMerchantCategorized.get(r.merchant_name) ?? [];
    list.push({ date: new Date(r.posted_date).toISOString().split('T')[0], amount: Number(r.amount) });
    byMerchantCategorized.set(r.merchant_name, list);
  }

  const entries: SubscriptionEntry[] = [];
  for (const [merchant, occurrences] of byMerchantCategorized) {
    entries.push(buildEntry(merchant, 'category', occurrences));
  }

  // Signal 2: recurring monthly-or-slower charges anywhere else in the last
  // 180 days -- catches a subscription that landed in the wrong category.
  // Weekly/biweekly cadences are excluded here on purpose: at that
  // frequency a merchant match is far more likely to be routine spending
  // (transit, coffee) than an actual subscription.
  const { rows: everything } = await db.query<{ merchant_name: string; posted_date: string; amount: string }>(
    `SELECT t.merchant_name, t.posted_date, -t.amount AS amount
     FROM budgetable_transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE t.amount < 0 AND t.merchant_name IS NOT NULL
       AND t.posted_date >= CURRENT_DATE - INTERVAL '180 days'
       AND (c.name IS DISTINCT FROM 'Subscriptions' AND (p.name IS DISTINCT FROM 'Subscriptions' OR p.name IS NULL))
     ORDER BY t.merchant_name, t.posted_date`,
  );

  const byMerchantOther = new Map<string, Occurrence[]>();
  for (const r of everything) {
    const list = byMerchantOther.get(r.merchant_name) ?? [];
    list.push({ date: new Date(r.posted_date).toISOString().split('T')[0], amount: Number(r.amount) });
    byMerchantOther.set(r.merchant_name, list);
  }

  for (const [merchant, occurrences] of byMerchantOther) {
    // Two coincidentally-spaced visits is weak evidence on its own -- two
    // McDonald's runs 29 days apart isn't a subscription, it's a coincidence.
    // Three-in-a-row at the same cadence is a much stronger signal.
    if (occurrences.length < 3) continue;
    const cadence = detectCadence(occurrences.map((o) => o.date));
    if (cadence !== 'monthly' && cadence !== 'quarterly' && cadence !== 'annual') continue;

    // A real subscription charges roughly the same amount each time. A
    // McDonald's order that happens to land on a monthly-ish cadence still
    // swings wildly in price ($14 vs $28) -- that variance is the actual
    // tell that it's ordinary variable spending, not this feature's job to
    // report as "price creep".
    const amounts = occurrences.map((o) => o.amount);
    if (Math.max(...amounts) / Math.min(...amounts) > 1.5) continue;

    entries.push(buildEntry(merchant, 'pattern', occurrences));
  }

  return entries.sort((a, b) => b.estimatedMonthly - a.estimatedMonthly);
}
