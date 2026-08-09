# Budget dashboard

Personal budget dashboard: Next.js on Vercel, Postgres on Neon. This build has
a real, verified deploy pipeline (`npx next build` passes, 25 tests pass) — the
dashboard UI itself is a placeholder you'll fill in as you build out the
categorizer, budget rollups, and alerts.

## Step by step: from zero to a live URL

### 1. Create a GitHub repo and push this code

```bash
cd budget
git init
git add .
git commit -m "Initial scaffold: schema, CSV import, Next.js shell"
```

Create an empty repo on github.com (no README/gitignore — you already have
one), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/budget.git
git branch -M main
git push -u origin main
```

### 2. Create your Neon database

1. Sign up at [neon.tech](https://neon.tech) (GitHub login is fastest).
2. Create a project, name it `budget`, pick a region close to you
   (US East / Ohio is closest to Calgary of Neon's current regions).
3. On the project dashboard, click **Connection Details** and copy the
   **pooled connection** string. It looks like:
   `postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/budget?sslmode=require`
4. Save it somewhere for step 3 — this is the only secret you need for the
   database.

### 3. Apply the schema

Locally, with `psql` installed (`brew install postgresql` on Mac,
`apt install postgresql-client` on Linux):

```bash
psql "postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/budget?sslmode=require" -f schema.sql
```

If you don't want to install `psql`, Neon's dashboard has a **SQL Editor** —
paste the contents of `schema.sql` in and run it there instead.

Verify it worked:

```bash
psql "$DATABASE_URL" -c "\dt"
```

You should see `accounts`, `transactions`, `budgets`, `categories`, and the
rest of the tables from `schema.sql`.

### 4. Run it locally

```bash
npm install
cp .env.example .env.local
# edit .env.local — paste your Neon connection string into DATABASE_URL
npm run dev
```

Open `http://localhost:3000` — you should see the placeholder page. Click
"Check database connection" (or visit `/api/health`) — it should return
`{"ok": true, "dbTime": ..., "transactionCount": 0}`. If it errors, the
connection string is almost always the cause; re-copy it from Neon.

### 5. Deploy to Vercel

1. Sign up at [vercel.com](https://vercel.com) with GitHub.
2. **Add New Project** → import the repo you pushed in step 1.
3. Vercel auto-detects Next.js — leave build settings as default.
4. Before deploying, add environment variables (**Environment Variables**
   section on the import screen, or **Project Settings → Environment
   Variables** afterward):
   - `DATABASE_URL` — the same Neon connection string from step 2
   - `CRON_SECRET` — generate one locally with `openssl rand -hex 32`
5. Click **Deploy**. Takes about a minute.
6. Visit `https://your-project.vercel.app/api/health` to confirm the deployed
   app can reach Neon. Same success shape as step 4.

You now have a live URL, a real Postgres database, and zero recurring cost.

### 6. Install it on your phone

The manifest (`public/manifest.json`) is already wired into `layout.tsx`, so
the app is installable as-is — you just need two icon files:

1. Make a simple 512×512 square icon (even a plain colored square with your
   initials works to start — you can improve it later). Export it as PNG.
2. Resize a copy to 192×192.
3. Drop both into `public/` as `icon-512.png` and `icon-192.png`, commit, push.
   Vercel redeploys automatically.
4. On your phone: open the Vercel URL in Safari (iOS) or Chrome (Android) →
   **Share → Add to Home Screen** (iOS) or the **Install** prompt (Android).

It now opens full-screen from your home screen like a native app.

### 7. Turn on the daily sync cron

`vercel.json` already declares a cron hitting `/api/cron/sync` once a day —
Vercel registers it automatically on deploy, no dashboard step needed. Confirm
it's registered under **Project → Cron Jobs** in the Vercel dashboard.

Right now that route is a stub that just proves the schedule fires — check
**Cron Jobs → Logs** the day after your first deploy to confirm it ran. The
actual sync logic goes in there once you complete step 9 below.

### 8. Import your first CSV and build the real dashboard

Use `src/lib/import/import.ts` (`importCsv`) from an API route or a small
script to load a real export and confirm dates/amounts look right — see the
main README section below for exact usage. Once transactions are in Postgres,
replace the placeholder `src/app/page.tsx` with actual balance, spend-by-
category, and budget-progress views reading from `budgetable_transactions`.

### 9. Wire up Plaid (optional — CSV works fine without it)

Sign up at [dashboard.plaid.com](https://dashboard.plaid.com), start a Trial
plan, add `PLAID_CLIENT_ID` / `PLAID_SECRET` to Vercel's env vars, and build
the Link flow + `/transactions/sync` handler. This slots into the same
`NormalizedTransaction` shape the CSV importer already produces — the adapter
is new, nothing else changes.

### 10. Wire up budget alerts

Simplest free option: [ntfy.sh](https://ntfy.sh) — pick a private topic name,
add it as `NTFY_TOPIC` in Vercel, install the ntfy app on your phone and
subscribe to that topic. From the cron route, alerting is one HTTP POST:

```ts
await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
  method: 'POST',
  body: 'Groceries: 104% of budget ($312 of $300)',
});
```

Check `alerts_sent` before sending so you don't re-fire the same threshold
every day for the rest of the period (see schema.sql comments on that table).

---

## Data layer reference

Schema and CSV ingest for the personal budget dashboard. This is the foundation
everything else sits on: get the transaction table right and the categorizer,
budget rollups, alerting, and eventual Plaid adapter all become straightforward.

## Files

```
schema.sql                        Postgres schema
src/lib/import/types.ts           Shared types — the NormalizedTransaction contract
src/lib/import/profiles.ts        Bank CSV layouts + detection
src/lib/import/normalize.ts       Date/amount/description parsing
src/lib/import/fingerprint.ts     Deduplication
src/lib/import/import.ts          DB writer
test/normalize.test.ts            25 checks over the parsing logic
```

## The three decisions worth knowing

**Sign convention: negative = money out.** `SUM(amount)` over any period is net
cash flow, and balance reconciliation works without thinking. Budget spend is
`SUM(-amount) FILTER (WHERE amount < 0)` — one negation, in one place.

Plaid uses the *opposite* convention (positive = outflow), so the Plaid adapter
must negate on ingest. This is the single most common source of inverted
dashboards, which is why `auditSignConvention()` exists and why `importCsv`
refuses by default when a file looks one-directional.

**Deduplication by (fingerprint, sequence).** Every bank export is "the last 90
days," so you re-import overlapping ranges constantly. The fingerprint hashes
account + date + amount + canonicalized description. The sequence number handles
the case that breaks naive fingerprinting: two identical purchases on the same
day are two transactions, not one. Re-importing an unchanged file inserts zero
rows; importing a file with one new coffee inserts exactly one.

**`category_source` protects manual work.** Every transaction records *why* it
has its category — `plaid`, `rule`, or `manual`. Precedence is
manual > rule > plaid, so a re-sync or a rule change never overwrites a call you
made by hand. Without this column, every categorizer improvement silently
destroys past corrections.

## Importing

```ts
import { parse } from 'csv-parse/sync';
import { detectProfile, getProfile } from './src/lib/import/profiles';
import { importCsv } from './src/lib/import/import';

const records = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true });
const profile = detectProfile(Object.keys(records[0])) ?? getProfile('rbc')!;

const summary = await importCsv({
  db, accountId, profile, rows: records, filename: 'rbc-2026-03.csv',
});
```

For headerless exports (TD, CIBC, Scotiabank), parse with `columns: false` and
map each row to `{ col0, col1, ... }`.

## Verify your profiles before trusting them

The profiles in `profiles.ts` are **starting points, not guarantees**. Bank CSV
layouts change without notice and differ between personal and business accounts,
between chequing and credit card exports, and sometimes between the "download"
and "export" buttons in the same online banking screen.

Before importing a year of history:

1. Open your real export in a text editor and compare the header (or first data
   row) against the profile.
2. Import a 10-row slice first.
3. Check three things against your actual statement: **do the dates match, do
   debits come out negative, and does the row count line up?**

`validateProfile()` catches wrong column names loudly. It cannot catch a wrong
*date format* — `01/02/2026` parses cleanly as either January 2nd or February
1st, and picking the wrong one shifts your data eleven months without an error.
Check the dates by eye on the first import. Once.

## Next

1. Categorization rules engine (`category_rules` → apply on insert)
2. Transfer matching (opposite-signed pairs across accounts within ±3 days)
3. Budget rollups against the `budgetable_transactions` view
4. Alerting with `alerts_sent` threshold state
5. Dashboard + PWA
6. Plaid adapter emitting the same `NormalizedTransaction` shape
