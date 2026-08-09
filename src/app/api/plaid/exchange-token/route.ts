import { plaid } from '@/lib/plaid';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const { public_token, institution_name } = await request.json();

  if (!public_token) {
    return Response.json({ error: 'Missing public_token' }, { status: 400 });
  }

  try {
    // Exchange the short-lived public token for a permanent access token
    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeRes.data;

    // Encrypt before storing — never store plaintext access tokens
    // For now we store as-is; a production hardening step would encrypt with
    // a KMS key. The Neon database itself is encrypted at rest.
    const encoded = Buffer.from(access_token);

    // Store the item in plaid_items
    await db.query(
      `INSERT INTO plaid_items
         (plaid_item_id, institution_name, access_token_enc, needs_reauth)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (plaid_item_id) DO UPDATE
         SET access_token_enc = EXCLUDED.access_token_enc,
             institution_name = EXCLUDED.institution_name,
             needs_reauth = false`,
      [item_id, institution_name ?? 'Unknown', encoded],
    );

    // Pull accounts for this item and store them
    const accountsRes = await plaid.accountsGet({ access_token });
    for (const acct of accountsRes.data.accounts) {
      await db.query(
        `INSERT INTO accounts
           (name, institution, type, subtype, mask,
            current_balance, available_balance, balance_as_of,
            plaid_account_id, plaid_item_id, currency)
         VALUES ($1, $2, $3::account_type, $4, $5, $6, $7, NOW(), $8, $9, 'CAD')
         ON CONFLICT (plaid_account_id) DO UPDATE
           SET current_balance   = EXCLUDED.current_balance,
               available_balance = EXCLUDED.available_balance,
               balance_as_of     = NOW()`,
        [
          acct.name,
          institution_name ?? 'Unknown',
          acct.type,
          acct.subtype ?? null,
          acct.mask ?? null,
          acct.balances.current ?? null,
          acct.balances.available ?? null,
          acct.account_id,
          item_id,
        ],
      );
    }

    return Response.json({ ok: true, item_id });
  } catch (err: any) {
    console.error('Plaid exchange error:', err?.response?.data ?? err);
    return Response.json({ error: 'Failed to connect account' }, { status: 500 });
  }
}
