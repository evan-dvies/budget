import { db } from './db';
import { getNextPayday } from './incomeSchedule';

export interface ChartSpec {
  type: 'bar' | 'pie';
  title: string;
  labels: string[];
  values: number[];
}

export interface AIInsightResult {
  answer: string;
  chart: ChartSpec | null;
}

/**
 * Aggregated spending summaries only -- category/month totals, budget vs
 * actual, account balances. Never sends the raw transaction list (merchant
 * names, individual purchases) to the API; that's more financial detail
 * than an insights feature needs to expose.
 */
async function gatherFinancialContext() {
  const [monthlyCategory, monthlyTotals, budgets, accounts, nextPayday] = await Promise.all([
    db.query<{ month: string; category: string; spent: string }>(
      `SELECT to_char(date_trunc('month', t.posted_date), 'YYYY-MM') AS month,
              c.name AS category, SUM(-t.amount) AS spent
       FROM budgetable_transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND t.posted_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
       GROUP BY 1, 2
       ORDER BY 1, 2`,
    ),
    db.query<{ month: string; spent: string; income: string }>(
      `SELECT to_char(date_trunc('month', posted_date), 'YYYY-MM') AS month,
              COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0) AS spent,
              COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS income
       FROM budgetable_transactions
       WHERE posted_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
       GROUP BY 1
       ORDER BY 1`,
    ),
    db.query<{ category: string; amount: string; spent: string }>(
      `SELECT c.name AS category, b.amount,
              (
                SELECT COALESCE(SUM(-t.amount), 0)
                FROM budgetable_transactions t
                WHERE t.amount < 0
                  AND t.posted_date >= date_trunc('month', CURRENT_DATE)
                  AND t.posted_date <  date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                  AND (
                    t.category_id = b.category_id
                    OR t.category_id IN (SELECT id FROM categories WHERE parent_id = b.category_id)
                  )
              ) AS spent
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE b.effective_to IS NULL
       ORDER BY c.name`,
    ),
    db.query<{ name: string; institution: string; current_balance: string | null }>(
      `SELECT name, institution, current_balance FROM accounts WHERE is_active = TRUE`,
    ),
    getNextPayday(),
  ]);

  return {
    currency: 'CAD',
    monthlyCategorySpend: monthlyCategory.rows,
    monthlyTotals: monthlyTotals.rows,
    currentMonthBudgets: budgets.rows,
    accountBalances: accounts.rows,
    nextPayday, // { amount, date, daysUntil } or null -- use for cash-flow-aware planning advice
  };
}

export async function askAI(userPrompt: string): Promise<AIInsightResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const context = await gatherFinancialContext();

  const prompt = `You are a financial assistant analyzing this person's personal budget data. Respond with ONLY a JSON object -- no markdown, no code fences, no text outside the JSON -- matching exactly this shape:
{"answer": "2-4 sentence plain-English answer, can include specific dollar amounts", "chart": null or {"type": "bar" or "pie", "title": "short title", "labels": ["..."], "values": [123.45, ...]}}

Only include a chart when comparing multiple categories or months would genuinely clarify the answer; use null otherwise. All amounts are in CAD. If the data doesn't cover enough history to answer confidently, say so plainly rather than guessing. nextPayday tells you when their next paycheck lands and for how much -- use it for cash-flow-aware advice (e.g. "you have $X to last until payday in N days") when the question is about planning ahead, not just past spending.

Data:
${JSON.stringify(context, null, 2)}

Question:
${userPrompt}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      // Sonnet 5 runs adaptive thinking by default, which eats into this
      // budget before the visible answer even starts -- 1024 was cutting
      // off longer answers mid-sentence.
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Sonnet 5 runs adaptive thinking by default, so content[0] can be a
  // "thinking" block rather than the "text" block on a complex prompt --
  // find the text block explicitly instead of assuming it's first.
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
  const text = (textBlock?.text ?? '').trim();

  try {
    const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const chart = parsed.chart && (parsed.chart.type === 'bar' || parsed.chart.type === 'pie')
      ? {
          type: parsed.chart.type as 'bar' | 'pie',
          title: String(parsed.chart.title ?? ''),
          labels: Array.isArray(parsed.chart.labels) ? parsed.chart.labels.map(String) : [],
          values: Array.isArray(parsed.chart.values) ? parsed.chart.values.map(Number) : [],
        }
      : null;
    return { answer: String(parsed.answer ?? 'No answer returned.'), chart };
  } catch {
    return { answer: text || 'Something went wrong reading the AI response.', chart: null };
  }
}
