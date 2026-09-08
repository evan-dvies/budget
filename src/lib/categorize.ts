import { db } from './db';

export interface CategoryRule {
  id: string;
  priority: number;
  match_field: 'description_clean' | 'description_raw' | 'merchant_name';
  match_type: 'contains' | 'starts_with' | 'equals' | 'regex';
  pattern: string;
  category_id: string;
  sets_transfer: boolean;
  account_id: string | null;
  direction: 'inflow' | 'outflow' | null;
  min_abs_amount: string | null;
}

export interface LeafCategory {
  id: string;
  name: string;
  parent_name: string | null;
}

export interface CategorizableTransaction {
  id: string;
  account_id: string;
  description_raw: string;
  description_clean: string;
  merchant_name: string | null;
  amount: string;
  posted_at: string | null;
}

const UBER_LYFT_LATE_NIGHT_CATEGORY = 'Going Out';

async function loadRules(): Promise<CategoryRule[]> {
  const { rows } = await db.query<CategoryRule>(
    `SELECT id, priority, match_field, match_type, pattern, category_id,
            sets_transfer, account_id, direction, min_abs_amount
     FROM category_rules
     WHERE enabled = TRUE
     ORDER BY priority ASC, id ASC`,
  );
  return rows;
}

async function loadLeafCategories(): Promise<LeafCategory[]> {
  const { rows } = await db.query<LeafCategory>(
    `SELECT c.id, c.name, p.name AS parent_name
     FROM categories c
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE c.archived = FALSE
     ORDER BY p.name NULLS FIRST, c.name`,
  );
  return rows;
}

function fieldValue(txn: CategorizableTransaction, field: CategoryRule['match_field']): string {
  if (field === 'description_raw') return txn.description_raw ?? '';
  if (field === 'merchant_name') return txn.merchant_name ?? '';
  return txn.description_clean ?? '';
}

function matches(rule: CategoryRule, txn: CategorizableTransaction): boolean {
  if (rule.account_id && rule.account_id !== txn.account_id) return false;

  const amount = Number(txn.amount);
  if (rule.direction === 'inflow' && amount <= 0) return false;
  if (rule.direction === 'outflow' && amount >= 0) return false;
  if (rule.min_abs_amount !== null && Math.abs(amount) < Number(rule.min_abs_amount)) return false;

  const pattern = rule.pattern.toUpperCase();
  const test = (value: string): boolean => {
    switch (rule.match_type) {
      case 'contains': return value.includes(pattern);
      case 'starts_with': return value.startsWith(pattern);
      case 'equals': return value === pattern;
      case 'regex':
        try {
          return new RegExp(rule.pattern, 'i').test(value);
        } catch {
          return false;
        }
    }
  };

  if (test(fieldValue(txn, rule.match_field).toUpperCase())) return true;

  // merchant_name is SimpleFIN's own cleaned payee, often a better-cleaned
  // alias of description_clean ("SQ *BIG ROCK BREWERY" -> "Big Rock
  // Brewery") -- check it too for rules written against description_clean,
  // without touching 'equals' semantics (used for AI-cache rules keyed on
  // one exact description_clean string).
  if (rule.match_field === 'description_clean' && rule.match_type !== 'equals' && txn.merchant_name) {
    return test(txn.merchant_name.toUpperCase());
  }
  return false;
}

/**
 * Uber/Lyft rides late on a Friday/Saturday night are a night-out expense,
 * not commuting -- this is a one-off business rule, not worth generalizing
 * the rule schema for a single vendor's edge case.
 */
function applyLateNightRideOverride(
  matchedCategoryName: string,
  txn: CategorizableTransaction,
  categoriesByName: Map<string, LeafCategory>,
): LeafCategory | null {
  if (matchedCategoryName !== 'Uber/Lyft' || !txn.posted_at) return null;

  const local = new Date(txn.posted_at).toLocaleString('en-US', {
    timeZone: 'America/Edmonton',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
  });
  const [weekday, hourStr] = local.split(', ');
  const hour = Number(hourStr);
  const isFriOrSat = weekday === 'Fri' || weekday === 'Sat';
  const isLateNight = hour >= 22 || hour < 4;

  if (isFriOrSat && isLateNight) {
    return categoriesByName.get(UBER_LYFT_LATE_NIGHT_CATEGORY) ?? null;
  }
  return null;
}

async function aiCategorize(
  txn: CategorizableTransaction,
  leafCategories: LeafCategory[],
): Promise<LeafCategory | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const options = leafCategories
    .filter((c) => c.parent_name) // leaves only, not group headers
    .map((c) => `${c.parent_name} > ${c.name}`);

  const amount = Number(txn.amount);
  const timeOfDay = txn.posted_at
    ? new Date(txn.posted_at).toLocaleString('en-US', { timeZone: 'America/Edmonton', hour12: true, hour: 'numeric', minute: '2-digit' })
    : 'unknown';

  const prompt = `Categorize this bank transaction into exactly one of the following categories. Reply with ONLY the category text, exactly as written, nothing else.

Categories:
${options.join('\n')}

Transaction:
description: ${txn.description_clean}
amount: ${amount} (negative = money out, positive = money in)
time of day: ${timeOfDay}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 40,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('AI categorize failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    const match = leafCategories.find((c) => `${c.parent_name} > ${c.name}` === text || c.name === text);
    return match ?? null;
  } catch (err) {
    console.error('AI categorize error:', (err as Error).message);
    return null;
  }
}

async function cacheAiResult(descriptionClean: string, categoryId: string) {
  await db.query(
    `INSERT INTO category_rules (priority, match_field, match_type, pattern, category_id, enabled)
     VALUES (500, 'description_clean', 'equals', $1, $2, TRUE)
     ON CONFLICT (pattern) WHERE match_field = 'description_clean' AND match_type = 'equals'
       DO NOTHING`,
    [descriptionClean, categoryId],
  );
}

/**
 * Categorizes one transaction against already-loaded rules/categories:
 * curated rules first, then (if nothing matched and an API key is
 * configured) an AI fallback whose result gets cached as a new rule so the
 * same merchant never hits the AI again. Never overrides a manually-set
 * category. Callers processing many transactions should load rules/
 * categories once and call this directly rather than categorizeTransaction.
 */
export async function categorizeWithContext(
  txn: CategorizableTransaction,
  rules: CategoryRule[],
  leafCategories: LeafCategory[],
): Promise<void> {
  const categoriesById = new Map(leafCategories.map((c) => [c.id, c]));
  const categoriesByName = new Map(leafCategories.map((c) => [c.name, c]));

  let resolved: LeafCategory | null = null;
  let source: 'rule' | 'ai' = 'rule';
  let setsTransfer = false;

  for (const rule of rules) {
    if (!matches(rule, txn)) continue;
    const category = categoriesById.get(rule.category_id);
    if (!category) continue;

    const override = applyLateNightRideOverride(category.name, txn, categoriesByName);
    resolved = override ?? category;
    setsTransfer = rule.sets_transfer;
    break;
  }

  if (!resolved) {
    const aiResult = await aiCategorize(txn, leafCategories);
    if (aiResult) {
      resolved = aiResult;
      source = 'ai';
      await cacheAiResult(txn.description_clean, aiResult.id);
      // Make the newly-cached rule visible to later transactions in this
      // same batch (categorizeAll shares one `rules` array across the
      // whole run), so an identical description never hits the AI twice
      // even within a single backfill pass.
      rules.push({
        id: `pending-${aiResult.id}-${rules.length}`,
        priority: 500,
        match_field: 'description_clean',
        match_type: 'equals',
        pattern: txn.description_clean,
        category_id: aiResult.id,
        sets_transfer: false,
        account_id: null,
        direction: null,
        min_abs_amount: null,
      });
    }
  }

  if (!resolved) return; // stays 'uncategorized'

  await db.query(
    `UPDATE transactions
     SET category_id = $1, category_source = $2, is_transfer = is_transfer OR $3
     WHERE id = $4 AND category_source != 'manual'`,
    [resolved.id, source, setsTransfer, txn.id],
  );
}

/**
 * Loads rules + categories once for callers processing multiple
 * transactions (a sync batch, a backfill run) so each transaction doesn't
 * re-query them individually.
 */
export async function loadCategorizationContext(): Promise<{ rules: CategoryRule[]; leafCategories: LeafCategory[] }> {
  const [rules, leafCategories] = await Promise.all([loadRules(), loadLeafCategories()]);
  return { rules, leafCategories };
}

/** Convenience wrapper for a single transaction (loads rules/categories fresh). */
export async function categorizeTransaction(txn: CategorizableTransaction): Promise<void> {
  const { rules, leafCategories } = await loadCategorizationContext();
  await categorizeWithContext(txn, rules, leafCategories);
}

export async function categorizeAll(): Promise<{ processed: number }> {
  const { rules, leafCategories } = await loadCategorizationContext();
  const { rows } = await db.query<CategorizableTransaction>(
    `SELECT id, account_id, description_raw, description_clean, merchant_name, amount, posted_at
     FROM transactions
     WHERE category_source != 'manual'
     ORDER BY posted_date DESC`,
  );

  for (const txn of rows) {
    // Rules were loaded once above, but a rule this loop just cached via
    // the AI path (cacheAiResult) needs to be visible to later iterations
    // that share the same description -- reload only when that happened.
    await categorizeWithContext(txn, rules, leafCategories);
  }
  return { processed: rows.length };
}
