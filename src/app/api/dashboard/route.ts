import { db } from '@/lib/db';

interface AccountRow {
  id: string;
  name: string;
  institution: string;
  currency: string;
  current_balance: string | null;
  balance_as_of: string | null;
}

interface TransactionRow {
  id: string;
  account_id: string;
  account_name: string;
  posted_date: string;
  amount: string;
  currency: string;
  description_clean: string;
  description_raw: string;
  merchant_name: string | null;
  pending: boolean;
  category_id: string | null;
  category_name: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  parent_name: string | null;
}

interface BudgetRow {
  category_id: string;
  category_name: string;
  amount: string;
  spent: string;
}

/** Validates "YYYY-MM" (month 01-12); falls back to the current month for anything else. */
function resolveMonth(param: string | null): string {
  const match = param?.match(/^(\d{4})-(\d{2})$/);
  const monthNum = match ? Number(match[2]) : NaN;
  if (match && monthNum >= 1 && monthNum <= 12) return `${param}-01`;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthStart = resolveMonth(searchParams.get('month'));

    const { rows: accounts } = await db.query<AccountRow>(
      `SELECT id, name, institution, currency, current_balance, balance_as_of
       FROM accounts
       WHERE is_active = TRUE
       ORDER BY institution, name`,
    );

    const { rows: transactions } = await db.query<TransactionRow>(
      `SELECT t.id, t.account_id, a.name AS account_name, t.posted_date,
              t.amount, t.currency, t.description_clean, t.description_raw, t.merchant_name, t.pending,
              t.category_id, c.name AS category_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       ORDER BY t.posted_date DESC, t.created_at DESC
       LIMIT 50`,
    );

    const { rows: categoryOptions } = await db.query<CategoryOption>(
      `SELECT c.id, c.name, p.name AS parent_name
       FROM categories c
       JOIN categories p ON p.id = c.parent_id
       WHERE c.archived = FALSE AND p.name != 'Transfers'
       ORDER BY p.name, c.name`,
    );

    // Spend/income excluding transfers/excluded/pending (budgetable_transactions
    // already filters those out), scoped to whichever month was requested --
    // defaults to the current one, but a past month can be viewed explicitly.
    // A budget can target a leaf category or a parent group (e.g. "Shopping"
    // covers all of Clothing/Amazon/General Shopping) -- a correlated
    // subquery avoids the row fan-out a join against child categories would
    // otherwise cause for anything categorized directly to the group itself.
    // The budget *amount* used is whichever version was actually in force
    // during the requested month, not necessarily today's -- budgets are
    // versioned by date specifically so a past month keeps showing the
    // limit that applied then.
    const { rows: budgets } = await db.query<BudgetRow>(
      `SELECT b.category_id, c.name AS category_name, b.amount,
              (
                SELECT COALESCE(SUM(-t.amount), 0)
                FROM budgetable_transactions t
                WHERE t.amount < 0
                  AND t.posted_date >= $1::date
                  AND t.posted_date <  $1::date + INTERVAL '1 month'
                  AND (
                    t.category_id = b.category_id
                    OR t.category_id IN (SELECT id FROM categories WHERE parent_id = b.category_id)
                  )
              ) AS spent
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE b.effective_from <= $1::date
         AND (b.effective_to IS NULL OR b.effective_to > $1::date)
       ORDER BY c.name`,
      [monthStart],
    );

    const { rows: monthTotals } = await db.query<{ spent: string; income: string }>(
      `SELECT
         COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0) AS spent,
         COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS income
       FROM budgetable_transactions
       WHERE posted_date >= $1::date
         AND posted_date <  $1::date + INTERVAL '1 month'`,
      [monthStart],
    );

    return Response.json({
      ok: true,
      month: monthStart.slice(0, 7),
      accounts,
      transactions,
      categoryOptions,
      budgets,
      monthTotals: monthTotals[0] ?? { spent: '0', income: '0' },
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
