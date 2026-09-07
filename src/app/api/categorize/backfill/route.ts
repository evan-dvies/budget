import { categorizeAll } from '@/lib/categorize';

export async function POST() {
  try {
    const result = await categorizeAll();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
