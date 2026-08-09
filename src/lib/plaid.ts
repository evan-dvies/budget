import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

const env = process.env.PLAID_ENV as keyof typeof PlaidEnvironments ?? 'sandbox';

const config = new Configuration({
  basePath: PlaidEnvironments[env],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaid = new PlaidApi(config);
