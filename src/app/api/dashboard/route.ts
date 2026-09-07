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
  pending: boolean;
}

export async function GET() {
  try {
    const { rows: accounts } = await db.query<AccountRow>(
      `SELECT id, name, institution, currency, current_balance, balance_as_of
       FROM accounts
       WHERE is_active = TRUE
       ORDER BY institution, name`,
    );

    const { rows: transactions } = await db.query<TransactionRow>(
      `SELECT t.id, t.account_id, a.name AS account_name, t.posted_date,
              t.amount, t.currency, t.description_clean, t.description_raw, t.pending
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       ORDER BY t.posted_date DESC, t.created_at DESC
       LIMIT 50`,
    );

    return Response.json({ ok: true, accounts, transactions });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
