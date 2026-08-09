import { neon } from '@neondatabase/serverless';

/**
 * Neon's serverless driver talks HTTP, not a persistent TCP connection — which
 * is exactly what a Vercel serverless function wants, since a normal `pg` Pool
 * would try to hold connections open across invocations that don't share
 * process memory. One call per request, no pooling to manage.
 */
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
}

const sql = neon(process.env.DATABASE_URL);

/**
 * Thin wrapper matching the `Db` interface expected by src/lib/import/import.ts,
 * so the importer doesn't care whether it's talking to Neon, `pg`, or a test
 * double.
 */
export const db = {
  async query<T = any>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const rows = await sql(text, params);
    return { rows: rows as T[] };
  },
};
