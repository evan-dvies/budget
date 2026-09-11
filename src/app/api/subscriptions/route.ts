import { detectSubscriptions, dismissSubscription } from '@/lib/subscriptions';

export async function GET() {
  try {
    const subscriptions = await detectSubscriptions();
    const totalMonthly = Math.round(subscriptions.reduce((sum, s) => sum + s.estimatedMonthly, 0) * 100) / 100;
    const priceCreepCount = subscriptions.filter((s) => s.isPriceCreep).length;
    return Response.json({ ok: true, subscriptions, totalMonthly, priceCreepCount });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { merchant } = await request.json();
    if (!merchant || typeof merchant !== 'string') {
      return Response.json({ ok: false, error: 'merchant is required' }, { status: 400 });
    }
    await dismissSubscription(merchant);
    const subscriptions = await detectSubscriptions();
    const totalMonthly = Math.round(subscriptions.reduce((sum, s) => sum + s.estimatedMonthly, 0) * 100) / 100;
    const priceCreepCount = subscriptions.filter((s) => s.isPriceCreep).length;
    return Response.json({ ok: true, subscriptions, totalMonthly, priceCreepCount });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
