import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
}

const sql = neon(process.env.DATABASE_URL);

export const db = {
  async query<T = any>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const rows = await sql.query(text, params as any[]);
    return { rows: rows as T[] };
  },
};
