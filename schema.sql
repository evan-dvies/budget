
-- ---------------------------------------------------------------------------
-- SimpleFIN access (added after initial schema)
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS simplefin_account_id TEXT UNIQUE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'csv';

CREATE TABLE IF NOT EXISTS simplefin_access (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_url_enc  BYTEA NOT NULL,
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
