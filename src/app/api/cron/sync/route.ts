/**
 * Hit by Vercel Cron once a day (see vercel.json). Protected by CRON_SECRET so
 * a stranger who finds this URL can't trigger it — Vercel sends the secret as
 * a Bearer token automatically for its own cron invocations; anyone else has
 * to know it.
 *
 * Currently a no-op placeholder. Step 9 in README replaces the body with the
 * actual Plaid /transactions/sync call once that's wired up.
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // TODO (README step 9): for each row in plaid_items, call
  // /transactions/sync with the stored cursor, upsert results, update cursor.
  // TODO (README step 10): after sync, recompute budget spend and fire alerts
  // for any threshold crossed since alerts_sent.

  return Response.json({ ok: true, ranAt: new Date().toISOString() });
}
