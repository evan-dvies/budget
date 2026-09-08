-- Personal budget dashboard — Postgres schema
--
-- SIGN CONVENTION (read this before writing any query):
--   amount < 0  = money LEFT the account (spending, fees, transfers out)
--   amount > 0  = money ENTERED the account (income, refunds, transfers in)
--
-- SUM(amount) over a period therefore equals net cash flow.
-- Budget "spend" is SUM(-amount) FILTER (WHERE amount < 0).
--
-- NOTE: Plaid uses the OPPOSITE convention (positive = outflow). The Plaid
-- adapter must negate `amount` on ingest. This is the single most common
-- source of inverted-dashboard bugs.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TYPE account_type AS ENUM ('depository', 'credit', 'loan', 'investment', 'other');
CREATE TYPE data_source  AS ENUM ('csv', 'plaid', 'manual');

CREATE TABLE accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    institution         TEXT NOT NULL,
    type                account_type NOT NULL,
    subtype             TEXT,
    currency            CHAR(3) NOT NULL DEFAULT 'CAD',
    mask                TEXT,                       -- last 4 digits, display only
    current_balance     NUMERIC(14, 2),
    available_balance   NUMERIC(14, 2),
    balance_as_of       TIMESTAMPTZ,

    -- Populated only once you wire up Plaid. Null for CSV-only accounts.
    plaid_account_id    TEXT UNIQUE,
    plaid_item_id       TEXT,

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX accounts_plaid_item_idx ON accounts (plaid_item_id) WHERE plaid_item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    parent_id       UUID REFERENCES categories (id) ON DELETE RESTRICT,
    is_income       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Maps Plaid's personal_finance_category onto your taxonomy so the Plaid
    -- adapter can auto-assign. Many Plaid categories may map to one of yours.
    plaid_primary   TEXT,
    plaid_detailed  TEXT,

    sort_order      INTEGER NOT NULL DEFAULT 0,
    archived        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (name, parent_id)
);

CREATE INDEX categories_plaid_detailed_idx ON categories (plaid_detailed) WHERE plaid_detailed IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

-- Tracks WHY a transaction has the category it has, so that re-syncing never
-- overwrites a decision you made by hand. Precedence: manual > rule > plaid.
CREATE TYPE category_source AS ENUM ('uncategorized', 'plaid', 'rule', 'manual');

CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,

    posted_date         DATE NOT NULL,
    authorized_date     DATE,                       -- Plaid provides this; CSV usually doesn't
    amount              NUMERIC(14, 2) NOT NULL,    -- see SIGN CONVENTION above
    currency            CHAR(3) NOT NULL DEFAULT 'CAD',

    description_raw     TEXT NOT NULL,              -- exactly as the source gave it
    description_clean   TEXT NOT NULL,              -- normalized, used for rule matching
    merchant_name       TEXT,                       -- best guess at the actual business

    category_id         UUID REFERENCES categories (id) ON DELETE SET NULL,
    category_source     category_source NOT NULL DEFAULT 'uncategorized',

    pending             BOOLEAN NOT NULL DEFAULT FALSE,
    -- When a Plaid pending transaction posts it arrives with a NEW id and
    -- points back at the old one. Store it so you can collapse the pair.
    pending_transaction_id TEXT,

    -- Transfers between your own accounts are not spending. Excluding them is
    -- the difference between a budget that works and one that double-counts.
    is_transfer         BOOLEAN NOT NULL DEFAULT FALSE,
    transfer_group_id   UUID,                       -- links the two sides of a matched pair
    is_excluded         BOOLEAN NOT NULL DEFAULT FALSE,  -- manual "ignore this" flag

    notes               TEXT,

    source              data_source NOT NULL,
    external_id         TEXT,                       -- Plaid transaction_id; null for CSV
    import_batch_id     UUID,

    -- Deduplication for sources with no stable id (i.e. CSV). See fingerprint.ts.
    -- fingerprint_seq disambiguates genuinely identical same-day transactions
    -- (two $4.50 coffees on the same Tuesday are two transactions, not one).
    fingerprint         TEXT NOT NULL,
    fingerprint_seq     SMALLINT NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Plaid's own id is authoritative when present.
CREATE UNIQUE INDEX transactions_external_id_key
    ON transactions (external_id) WHERE external_id IS NOT NULL;

-- Fingerprint dedup for CSV imports.
CREATE UNIQUE INDEX transactions_fingerprint_key
    ON transactions (fingerprint, fingerprint_seq);

CREATE INDEX transactions_account_date_idx ON transactions (account_id, posted_date DESC);
CREATE INDEX transactions_date_idx         ON transactions (posted_date DESC);
CREATE INDEX transactions_category_idx     ON transactions (category_id, posted_date DESC);
CREATE INDEX transactions_pending_idx      ON transactions (pending) WHERE pending = TRUE;

-- The rollup query the dashboard and the alert job both hit. Everything that
-- shouldn't count against a budget is filtered here, in one place.
CREATE VIEW budgetable_transactions AS
    SELECT *
    FROM transactions
    WHERE is_transfer = FALSE
      AND is_excluded = FALSE
      AND pending     = FALSE;

-- ---------------------------------------------------------------------------
-- Categorization rules
-- ---------------------------------------------------------------------------

CREATE TYPE match_type AS ENUM ('contains', 'starts_with', 'equals', 'regex');

CREATE TABLE category_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Lower number wins. Leave gaps (10, 20, 30) so you can insert later.
    priority        INTEGER NOT NULL DEFAULT 100,
    match_field     TEXT NOT NULL DEFAULT 'description_clean'
                        CHECK (match_field IN ('description_clean', 'description_raw', 'merchant_name')),
    match_type      match_type NOT NULL DEFAULT 'contains',
    pattern         TEXT NOT NULL,

    -- A rule can assign a category, flag a transfer, or both.
    category_id     UUID REFERENCES categories (id) ON DELETE CASCADE,
    sets_transfer   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Optional narrowing: only apply to one account, or to inflows/outflows only.
    account_id      UUID REFERENCES accounts (id) ON DELETE CASCADE,
    direction       TEXT CHECK (direction IN ('inflow', 'outflow')),

    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX category_rules_priority_idx ON category_rules (priority) WHERE enabled = TRUE;

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------

CREATE TYPE budget_period AS ENUM ('weekly', 'monthly', 'quarterly', 'annual');

CREATE TABLE budgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    period          budget_period NOT NULL DEFAULT 'monthly',
    amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),

    -- Budgets are versioned by date rather than edited in place, so that
    -- historical periods keep the limit that was actually in force at the time.
    effective_from  DATE NOT NULL,
    effective_to    DATE,                           -- NULL = still in force

    rollover        BOOLEAN NOT NULL DEFAULT FALSE, -- carry unspent amount forward
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Only one budget per category can be in force at a time.
CREATE UNIQUE INDEX budgets_active_key
    ON budgets (category_id) WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- Alert state
-- ---------------------------------------------------------------------------

-- The unique constraint here is the entire point of this table: it is what
-- stops you getting the same "over on groceries" push every day until month end.
CREATE TABLE alerts_sent (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id       UUID NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
    period_start    DATE NOT NULL,
    threshold_pct   SMALLINT NOT NULL,              -- 80, 100, 120
    spend_at_send   NUMERIC(12, 2) NOT NULL,
    channel         TEXT NOT NULL,                  -- 'push', 'sms', 'email'
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (budget_id, period_start, threshold_pct)
);

-- ---------------------------------------------------------------------------
-- Import bookkeeping
-- ---------------------------------------------------------------------------

CREATE TABLE import_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID REFERENCES accounts (id) ON DELETE SET NULL,
    source          data_source NOT NULL,
    filename        TEXT,
    profile_id      TEXT,                           -- which CSV profile was used
    rows_parsed     INTEGER NOT NULL DEFAULT 0,
    rows_inserted   INTEGER NOT NULL DEFAULT 0,
    rows_duplicate  INTEGER NOT NULL DEFAULT 0,
    rows_failed     INTEGER NOT NULL DEFAULT 0,
    error_log       JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions
    ADD CONSTRAINT transactions_import_batch_fk
    FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Plaid sync cursors
-- ---------------------------------------------------------------------------

-- /transactions/sync is cursor-based. Losing the cursor means a full re-sync,
-- which is survivable but slow, so it lives in its own durable table.
CREATE TABLE plaid_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plaid_item_id       TEXT NOT NULL UNIQUE,
    institution_id      TEXT,
    institution_name    TEXT,
    access_token_enc    BYTEA NOT NULL,             -- encrypted at rest, never plaintext
    sync_cursor         TEXT,
    last_synced_at      TIMESTAMPTZ,
    -- Set when Plaid sends ITEM_LOGIN_REQUIRED. The dashboard should show a
    -- "reconnect" banner whenever this is true, or your data silently goes stale.
    needs_reauth        BOOLEAN NOT NULL DEFAULT FALSE,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_touch     BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER transactions_touch BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- SimpleFIN access (added after initial schema, replaces Plaid as the bank
-- data source; plaid_* tables/columns above are left in place for now)
-- ---------------------------------------------------------------------------

ALTER TYPE data_source ADD VALUE IF NOT EXISTS 'simplefin';

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS simplefin_account_id TEXT UNIQUE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'csv';

CREATE TABLE IF NOT EXISTS simplefin_access (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_url_enc  BYTEA NOT NULL,
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Categorization & budgets (added after SimpleFIN migration)
-- ---------------------------------------------------------------------------

-- Full timestamp (SimpleFIN gives one; posted_date alone can't support
-- time-of-day rules like "late-night rideshare = going out, not commuting").
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

-- Amount-gated rules (e.g. a large e-transfer is probably a rent payment).
ALTER TABLE category_rules ADD COLUMN IF NOT EXISTS min_abs_amount NUMERIC(12,2);

-- category_source didn't have a value for "the AI categorizer guessed this,
-- treat it as low-confidence" -- same precedence tier as 'plaid'/'uncategorized',
-- always overridable by a real rule or a manual pick.
ALTER TYPE category_source ADD VALUE IF NOT EXISTS 'ai';

-- Every AI categorization gets cached as a new rule keyed on the exact
-- description, so the same merchant never hits the API twice.
CREATE UNIQUE INDEX IF NOT EXISTS category_rules_ai_cache_key
    ON category_rules (pattern)
    WHERE match_field = 'description_clean' AND match_type = 'equals';

-- Dedup key for curated (non-AI-cached) rules so re-seeding is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS category_rules_pattern_category_key
    ON category_rules (pattern, category_id);

-- categories' own UNIQUE(name, parent_id) table constraint never catches
-- duplicate top-level rows -- standard SQL treats every NULL parent_id as
-- distinct from every other NULL, so re-seeding a top-level category
-- (Income, Food, ...) silently inserted a fresh duplicate every run until
-- this index existed for ON CONFLICT to actually target.
CREATE UNIQUE INDEX IF NOT EXISTS categories_toplevel_name_key
    ON categories (name) WHERE parent_id IS NULL;

-- Categories, category_rules, and budgets are seeded by
-- scripts/seed-budget-system.mjs rather than inline here, since the seed
-- data references category ids that only exist after insertion.
