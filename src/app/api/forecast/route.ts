import { db } from '@/lib/db';
import { getNextPayday } from '@/lib/incomeSchedule';

const HORIZON_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

interface ForecastDay {
  date: string;
  balance: number;
  events: { label: string; amount: number }[];
}

function toDateOnly(d: Date): Date {
  return new Date(d.toISOString().split('T')[0]);
}

function addMonthsClamped(d: Date, months: number, dayOfMonth: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(dayOfMonth, lastDayOfTargetMonth);
  return new Date(Date.UTC(year, month, day));
}

export async function GET() {
  try {
    // Spendable balance: checking + credit card debt (negative = owed),
    // excluding savings vehicles -- same definition as "Safe to Spend" so
    // the two numbers agree on day 0.
    const { rows: accounts } = await db.query<{ name: string; current_balance: string | null }>(
      `SELECT name, current_balance FROM accounts WHERE is_active = TRUE`,
    );
    const startingBalance = accounts
      .filter((a) => !/tfsa|rrsp|saving/i.test(a.name))
      .reduce((sum, a) => sum + Number(a.current_balance ?? 0), 0);

    // Rent is the one bill big and regular enough to model as a discrete
    // monthly event rather than smoothing it into the average burn rate --
    // everything else (subscriptions, groceries, dining...) actually lands
    // in smaller, irregular charges throughout the month, so smoothing them
    // is more honest than pretending they're a single lump-sum date.
    const { rows: rentDayRows } = await db.query<{ day: number }>(
      `SELECT EXTRACT(DAY FROM t.posted_date)::int AS day
       FROM budgetable_transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Rent' AND t.posted_date >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY 1 ORDER BY COUNT(*) DESC, day ASC LIMIT 1`,
    );
    const rentDayOfMonth = rentDayRows[0]?.day ?? 1;

    const { rows: rentBudgetRows } = await db.query<{ amount: string; spent: string }>(
      `SELECT b.amount,
              (
                SELECT COALESCE(SUM(-t.amount), 0)
                FROM budgetable_transactions t
                WHERE t.amount < 0
                  AND t.category_id = b.category_id
                  AND t.posted_date >= date_trunc('month', CURRENT_DATE)
                  AND t.posted_date <  date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
              ) AS spent
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE c.name = 'Rent'
         AND b.effective_from <= CURRENT_DATE
         AND (b.effective_to IS NULL OR b.effective_to > CURRENT_DATE)
       LIMIT 1`,
    );
    const rentAmount = rentBudgetRows[0] ? Number(rentBudgetRows[0].amount) : 0;
    const rentRemainingThisCycle = rentBudgetRows[0]
      ? Math.max(rentAmount - Number(rentBudgetRows[0].spent), 0)
      : 0;

    // Everything else: an average daily burn from the trailing 30 days,
    // excluding Rent (handled above as a discrete event) so it isn't
    // counted twice.
    const { rows: burnRows } = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(-t.amount), 0) AS total
       FROM budgetable_transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0
         AND t.posted_date >= CURRENT_DATE - INTERVAL '30 days'
         AND (c.name IS DISTINCT FROM 'Rent')`,
    );
    const avgDailyBurn = Number(burnRows[0]?.total ?? 0) / 30;

    const today = toDateOnly(new Date());

    // Every payday landing within the window, projected the same way the
    // dashboard's "next payday" card is.
    const nextPayday = await getNextPayday();
    const paydayDates = new Map<string, number>();
    if (nextPayday) {
      let d = new Date(nextPayday.date + 'T00:00:00Z');
      while (d.getTime() <= today.getTime() + HORIZON_DAYS * DAY_MS) {
        paydayDates.set(d.toISOString().split('T')[0], nextPayday.amount);
        d = new Date(d.getTime() + 14 * DAY_MS);
      }
    }

    // Rent events: the remaining amount still owed this cycle (0 if already
    // paid) on the next occurrence of rentDayOfMonth, then the full budgeted
    // amount on each occurrence after that, monthly, for the rest of the
    // window. If the target day already passed this month without being
    // fully paid, treat it as due today rather than skipping straight to
    // next month.
    const rentDates = new Map<string, number>();
    if (rentAmount > 0) {
      let firstOccurrence: Date;
      let firstAmount: number;
      if (rentRemainingThisCycle > 0) {
        const thisMonthDay = addMonthsClamped(today, 0, rentDayOfMonth);
        firstOccurrence = thisMonthDay.getTime() >= today.getTime() ? thisMonthDay : today;
        firstAmount = rentRemainingThisCycle;
      } else {
        firstOccurrence = addMonthsClamped(today, 1, rentDayOfMonth);
        firstAmount = rentAmount;
      }
      rentDates.set(firstOccurrence.toISOString().split('T')[0], firstAmount);

      // Every occurrence after the first is a fresh month, so it's always
      // the full budgeted amount rather than a partial remaining balance.
      let next = firstOccurrence;
      while (true) {
        next = addMonthsClamped(next, 1, rentDayOfMonth);
        if (next.getTime() > today.getTime() + HORIZON_DAYS * DAY_MS) break;
        rentDates.set(next.toISOString().split('T')[0], rentAmount);
      }
    }

    const days: ForecastDay[] = [];
    let balance = startingBalance;
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const date = new Date(today.getTime() + i * DAY_MS);
      const dateStr = date.toISOString().split('T')[0];
      const events: { label: string; amount: number }[] = [];

      if (i > 0) {
        balance -= avgDailyBurn;
      }
      const payday = paydayDates.get(dateStr);
      if (payday) {
        balance += payday;
        events.push({ label: 'Paycheck', amount: payday });
      }
      const rent = rentDates.get(dateStr);
      if (rent) {
        balance -= rent;
        events.push({ label: 'Rent', amount: -rent });
      }

      days.push({ date: dateStr, balance: Math.round(balance * 100) / 100, events });
    }

    const lowest = days.reduce((min, d) => (d.balance < min.balance ? d : min), days[0]);
    const firstShortfall = days.find((d) => d.balance < 0) ?? null;

    return Response.json({
      ok: true,
      startingBalance,
      avgDailyBurn: Math.round(avgDailyBurn * 100) / 100,
      days,
      lowest,
      firstShortfall,
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
