// Applies schema.sql to whatever DATABASE_URL points at.
// Usage: npm run migrate
//
// NOTE: schema.sql contains a $$-quoted plpgsql function body (touch_updated_at)
// with semicolons inside it, and Neon's HTTP driver runs each query() call as a
// single statement. This works because we send the whole file as one query
// string using the simple protocol — but if you ever split schema.sql into
// multiple files, do NOT naively split on ";" or you will cut the function body
// in half. If this script errors partway through, `psql $DATABASE_URL -f
// schema.sql` (using the connection string from the Neon dashboard) is the more
// robust fallback — it's a real Postgres client, not an HTTP shim.
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const schema = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');

console.log('Applying schema.sql...');
try {
  // The neon() tag function only accepts a single statement per call in most
  // configurations. schema.sql is one big multi-statement script including a
  // $$-quoted function body, which the HTTP driver isn't guaranteed to handle
  // as one unit. Prefer psql for this one-time step — it's a real Postgres
  // client and has none of these edge cases:
  //
  //   psql "$DATABASE_URL" -f schema.sql
  //
  // Get the connection string from the Neon dashboard -> Connection Details.
  // This script is left in place for CI/automation contexts where installing
  // psql is inconvenient, but psql is the recommended path for first setup.
  await sql(schema, []);
  console.log('Done. Tables created.');
} catch (err) {
  console.error('Migration via HTTP driver failed:', err.message);
  console.error('\nFall back to: psql "$DATABASE_URL" -f schema.sql');
  process.exit(1);
}
