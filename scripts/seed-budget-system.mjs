// One-time migration + seed for the categorization/budget system.
// Usage: npm run seed:budget
//
// Idempotent: safe to re-run. Categories/rules/budgets are upserted by
// natural key (name+parent, pattern, category+period) so re-running just
// confirms nothing changed.
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function run(label, text, params = []) {
  try {
    const rows = await sql.query(text, params);
    console.log(`ok: ${label}`);
    return rows;
  } catch (err) {
    console.error(`FAILED: ${label}\n  ${err.message}`);
    throw err;
  }
}

async function upsertCategory(name, parentId, isIncome = false) {
  // categories' table-level UNIQUE(name, parent_id) constraint does NOT catch
  // duplicate top-level rows: standard SQL treats every NULL parent_id as
  // distinct from every other NULL, so ON CONFLICT (name, parent_id) silently
  // never fires for parent_id IS NULL and just inserts a fresh duplicate on
  // every re-run. categories_toplevel_name_key (a partial index scoped to
  // parent_id IS NULL, created above) is what actually enforces uniqueness
  // for top-level rows, so a top-level upsert has to target that index
  // specifically instead.
  const rows = parentId === null
    ? await sql.query(
        `INSERT INTO categories (name, parent_id, is_income)
         VALUES ($1, NULL, $2)
         ON CONFLICT (name) WHERE parent_id IS NULL DO UPDATE SET is_income = EXCLUDED.is_income
         RETURNING id`,
        [name, isIncome],
      )
    : await sql.query(
        `INSERT INTO categories (name, parent_id, is_income)
         VALUES ($1, $2, $3)
         ON CONFLICT (name, parent_id) DO UPDATE SET is_income = EXCLUDED.is_income
         RETURNING id`,
        [name, parentId, isIncome],
      );
  return rows[0].id;
}

async function main() {
  // --- Schema changes -------------------------------------------------
  await run(
    'add transactions.posted_at',
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ`,
  );
  await run(
    'add category_rules.min_abs_amount',
    `ALTER TABLE category_rules ADD COLUMN IF NOT EXISTS min_abs_amount NUMERIC(12,2)`,
  );
  await run(
    "add 'ai' to category_source enum",
    `ALTER TYPE category_source ADD VALUE IF NOT EXISTS 'ai'`,
  );
  await run(
    'add top-level category dedup index',
    `CREATE UNIQUE INDEX IF NOT EXISTS categories_toplevel_name_key
       ON categories (name) WHERE parent_id IS NULL`,
  );
  await run(
    'add AI-cache unique index on category_rules',
    `CREATE UNIQUE INDEX IF NOT EXISTS category_rules_ai_cache_key
       ON category_rules (pattern)
       WHERE match_field = 'description_clean' AND match_type = 'equals'`,
  );
  await run(
    'add curated-rule dedup index on category_rules',
    `CREATE UNIQUE INDEX IF NOT EXISTS category_rules_pattern_category_key
       ON category_rules (pattern, category_id)`,
  );

  // --- Categories -------------------------------------------------------
  const groups = {
    Income: { isIncome: true, children: ['Salary / Direct Deposit'] },
    Housing: { children: ['Rent'] },
    Food: { children: ['Groceries', 'Dining Out', 'Coffee'] },
    Transportation: { children: ['Gas', 'Uber/Lyft', 'Parking', 'Transit'] },
    'Going Out': { children: ['Bars/Nightlife/Booze', 'Entertainment'] },
    'Health & Fitness': { children: ['Gym', 'Supplements', 'Pharmacy', 'Medical', 'Nicotine Pouches'] },
    Shopping: { children: ['Clothing', 'Amazon/Online', 'General Shopping'] },
    Subscriptions: { children: ['Streaming', 'Music', 'Other Subscriptions'] },
    Transfers: { children: ['Credit Card Payment', 'Bank Transfer'] },
    Other: { children: ['Other Expenses'] },
  };

  const catId = {};
  for (const [groupName, { isIncome = false, children }] of Object.entries(groups)) {
    const groupId = await upsertCategory(groupName, null, isIncome);
    catId[groupName] = groupId;
    for (const child of children) {
      catId[child] = await upsertCategory(child, groupId, isIncome);
    }
  }
  console.log(`ok: seeded ${Object.keys(catId).length} categories`);

  // --- Category rules -----------------------------------------------------
  // priority: lower wins. 10-19 = amount/transfer-gated specifics,
  // 20-29 = transfer boilerplate, 30s = curated merchant lists.
  const rules = [
    // Rent: bare "RENT" always counts; a large e-transfer is a rent-payment heuristic.
    { priority: 10, pattern: 'RENT', type: 'contains', category: 'Rent' },
    { priority: 15, pattern: 'E-TRANSFER (TO|SENT)', type: 'regex', category: 'Rent', minAbsAmount: 500 },

    // Transfers between your own accounts / credit card bill payments.
    { priority: 20, pattern: 'PAYMENT - THANK YOU', type: 'contains', category: 'Credit Card Payment', setsTransfer: true },
    { priority: 20, pattern: 'ONLINE BANKING TRANSFER', type: 'contains', category: 'Bank Transfer', setsTransfer: true },

    // Income (inferred from observed deposit patterns).
    { priority: 30, pattern: 'PAYROLL|CPP CANADA', type: 'regex', category: 'Salary / Direct Deposit', direction: 'inflow' },

    // Curated merchant lists from the spec.
    { priority: 30, pattern: 'TIM HORTONS|STARBUCKS|SECOND CUP', type: 'regex', category: 'Coffee' },
    { priority: 30, pattern: 'SAFEWAY|SAVE-ON-FOODS|SAVE ON FOODS|SUPERSTORE|COSTCO|NO FRILLS|FRESHCO', type: 'regex', category: 'Groceries' },
    { priority: 30, pattern: 'SHELL|ESSO|PETRO-CANADA|PETRO CANADA|CO-OP GAS|CO OP GAS|HUSKY', type: 'regex', category: 'Gas' },
    { priority: 40, pattern: 'UBER|LYFT', type: 'regex', category: 'Uber/Lyft' },
    { priority: 30, pattern: 'NETFLIX|DISNEY\\+|DISNEY PLUS|CRAVE|APPLE TV', type: 'regex', category: 'Streaming' },
    { priority: 30, pattern: 'SPOTIFY|APPLE MUSIC', type: 'regex', category: 'Music' },
    { priority: 30, pattern: 'GNC|POPEYES SUPPLEMENTS|SUPPLEMENT KING', type: 'regex', category: 'Supplements' },
    { priority: 30, pattern: 'GOODLIFE|ANYTIME FITNESS|PLANET FITNESS|YMCA', type: 'regex', category: 'Gym' },
    { priority: 30, pattern: 'AMAZON|AMZN', type: 'regex', category: 'Amazon/Online' },

    // Added after reviewing real uncategorized transactions -- confident
    // single-purpose merchants/keywords, not a guess at ambiguous ones
    // (liquor stores, WestJet, generic .com retailers, etc. left alone).
    { priority: 30, pattern: 'CALGARY TRANSIT', type: 'contains', category: 'Transit' },
    { priority: 30, pattern: 'PARKING', type: 'contains', category: 'Parking' },
    { priority: 30, pattern: 'INDIGO PARK', type: 'contains', category: 'Parking' },
    { priority: 30, pattern: "MCDONALD|SUBWAY|WENDY'S|QUESADA", type: 'regex', category: 'Dining Out' },
    { priority: 30, pattern: 'PNE', type: 'contains', category: 'Dining Out' },
    { priority: 30, pattern: 'DONUT', type: 'contains', category: 'Coffee' },
    { priority: 30, pattern: "NAT'S COFFEE", type: 'contains', category: 'Coffee' },
    { priority: 30, pattern: 'PUB|BREWERY|BREWING|SALOON|TAVERN|TAP & BARREL', type: 'regex', category: 'Bars/Nightlife/Booze' },
    { priority: 30, pattern: 'SEATGEEK|TICKETLEADER|TICKETMASTER', type: 'regex', category: 'Entertainment' },
    { priority: 30, pattern: 'CASCADES CASINO', type: 'contains', category: 'Entertainment' },
    { priority: 30, pattern: 'OAK VIEW GROUP', type: 'contains', category: 'Bars/Nightlife/Booze' },
    { priority: 30, pattern: 'FOOT LOCKER', type: 'contains', category: 'Clothing' },
    { priority: 30, pattern: 'LULULEMON', type: 'contains', category: 'Clothing' },
    { priority: 30, pattern: 'DOLLARAMA', type: 'contains', category: 'General Shopping' },
    { priority: 30, pattern: 'FRAGRANCENET', type: 'contains', category: 'General Shopping' },
    { priority: 30, pattern: 'CRUNCHYROLL', type: 'contains', category: 'Streaming' },
    { priority: 30, pattern: 'ANTHROPIC', type: 'contains', category: 'Other Subscriptions' },
    { priority: 30, pattern: 'APPLE\\.COM/BILL', type: 'regex', category: 'Other Subscriptions' },

    // Gas-station-adjacent, identified by the user from local knowledge.
    { priority: 30, pattern: 'CENTEX', type: 'contains', category: 'Gas' },
    { priority: 30, pattern: 'CHEVRON', type: 'contains', category: 'Gas' },
    { priority: 30, pattern: 'AIR-SERV', type: 'contains', category: 'Gas' },

    // Bars/breweries/liquor -- liquor stores explicitly routed to Going Out
    // per the user (these are "going out drinking" purchases, not groceries).
    { priority: 30, pattern: 'BIG ROCK', type: 'contains', category: 'Bars/Nightlife/Booze' },
    { priority: 30, pattern: 'CRAFT 10TH AVE', type: 'contains', category: 'Bars/Nightlife/Booze' },
    { priority: 30, pattern: 'ROSE AND CROWN', type: 'contains', category: 'Bars/Nightlife/Booze' },
    { priority: 30, pattern: 'STREETCAR', type: 'contains', category: 'Bars/Nightlife/Booze' },
    { priority: 30, pattern: 'BC LIQUOR|ACE LIQUOR|LIQUOR QUICKER', type: 'regex', category: 'Bars/Nightlife/Booze' },

    { priority: 30, pattern: 'CLUB16', type: 'contains', category: 'Gym' },
    { priority: 30, pattern: 'SUPPLEMENT', type: 'contains', category: 'Supplements' },
    { priority: 30, pattern: 'ELYSIAN', type: 'contains', category: 'Coffee' },
    { priority: 30, pattern: 'RONA', type: 'contains', category: 'General Shopping' },
    { priority: 30, pattern: 'LONSDALE', type: 'contains', category: 'Clothing' },
    { priority: 30, pattern: 'MUSESC', type: 'contains', category: 'Music' },

    // Nicotine pouches -- identified by the user, no existing category fit.
    { priority: 30, pattern: 'TSAWWASSEN', type: 'contains', category: 'Nicotine Pouches' },
    { priority: 30, pattern: 'VALLEY RIDGE', type: 'contains', category: 'Nicotine Pouches' },

    // ATM cash deposits -- the user's own money going in, treated as income.
    { priority: 30, pattern: 'ATM DEPOSIT', type: 'contains', category: 'Salary / Direct Deposit', direction: 'inflow' },

    // Everything else the user explicitly called "other".
    { priority: 30, pattern: 'PURCHASE INTEREST', type: 'contains', category: 'Other Expenses' },
    { priority: 30, pattern: 'ONLINE TRANSFER TO DEPOSIT ACCOUNT', type: 'contains', category: 'Other Expenses' },
    { priority: 30, pattern: 'WESTJET', type: 'contains', category: 'Other Expenses' },
    { priority: 30, pattern: 'JOSEPH CHAI', type: 'contains', category: 'Other Expenses' },
    { priority: 30, pattern: 'MATTANDSTEVE', type: 'contains', category: 'Other Expenses' },
    { priority: 30, pattern: 'ICBC', type: 'contains', category: 'Other Expenses' },
    { priority: 30, pattern: '7 ELEVEN|7-ELEVEN|COCA COLA', type: 'regex', category: 'Other Expenses' },
  ];

  for (const r of rules) {
    const categoryId = catId[r.category];
    if (!categoryId) throw new Error(`Unknown category in rule seed: ${r.category}`);
    await sql.query(
      `INSERT INTO category_rules
         (priority, match_field, match_type, pattern, category_id, sets_transfer, direction, min_abs_amount, enabled)
       VALUES ($1, 'description_clean', $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (pattern, category_id) DO UPDATE
         SET priority = EXCLUDED.priority,
             match_type = EXCLUDED.match_type,
             sets_transfer = EXCLUDED.sets_transfer,
             direction = EXCLUDED.direction,
             min_abs_amount = EXCLUDED.min_abs_amount,
             enabled = TRUE`,
      [
        r.priority,
        r.type,
        r.pattern,
        categoryId,
        r.setsTransfer ?? false,
        r.direction ?? null,
        r.minAbsAmount ?? null,
      ],
    );
  }
  console.log(`ok: seeded ${rules.length} category rules`);

  // --- Budgets ------------------------------------------------------------
  const budgets = [
    ['Groceries', 400], ['Dining Out', 200], ['Coffee', 50],
    ['Gas', 150], ['Uber/Lyft', 100], ['Going Out', 200],
    ['Gym', 60], ['Supplements', 80], ['Shopping', 150], ['Subscriptions', 50],
  ];
  for (const [name, amount] of budgets) {
    const categoryId = catId[name];
    if (!categoryId) throw new Error(`Unknown category in budget seed: ${name}`);
    await sql.query(
      `INSERT INTO budgets (category_id, period, amount, effective_from, effective_to)
       VALUES ($1, 'monthly', $2, '2026-01-01', NULL)
       ON CONFLICT (category_id) WHERE effective_to IS NULL DO UPDATE
         SET amount = EXCLUDED.amount`,
      [categoryId, amount],
    );
  }
  console.log(`ok: seeded ${budgets.length} budgets`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
