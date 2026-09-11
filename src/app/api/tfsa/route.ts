import { getTfsaStatus, setTfsaRoom } from '@/lib/tfsa';

export async function GET() {
  try {
    const status = await getTfsaStatus();
    return Response.json({ ok: true, ...status });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { asOfDate, amount } = await request.json();
    if (!asOfDate || typeof asOfDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      return Response.json({ ok: false, error: 'asOfDate must be a YYYY-MM-DD string' }, { status: 400 });
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return Response.json({ ok: false, error: 'amount must be a non-negative number' }, { status: 400 });
    }

    await setTfsaRoom(asOfDate, parsedAmount);
    const status = await getTfsaStatus();
    return Response.json({ ok: true, ...status });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
