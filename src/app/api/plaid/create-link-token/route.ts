import { plaid } from '@/lib/plaid';
import { CountryCode, Products } from 'plaid';

export async function POST() {
  try {
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: 'evan' },
      client_name: 'Budget Dashboard',
      products: [Products.Transactions],
      country_codes: [CountryCode.Ca],
      language: 'en',
    });

    return Response.json({ link_token: response.data.link_token });
  } catch (err: any) {
    console.error('Plaid link token error:', err?.response?.data ?? err);
    return Response.json({ error: 'Failed to create link token' }, { status: 500 });
  }
}
