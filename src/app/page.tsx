'use client';

import { useEffect, useState } from 'react';

interface Account {
  id: string;
  name: string;
  institution: string;
  currency: string;
  current_balance: string | null;
  balance_as_of: string | null;
}

interface Transaction {
  id: string;
  account_id: string;
  account_name: string;
  posted_date: string;
  amount: string;
  currency: string;
  description_clean: string;
  description_raw: string;
  pending: boolean;
}

export default function DashboardPage() {
  const [setupToken, setSetupToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  async function loadDashboard() {
    setLoadingData(true);
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      if (data.ok) {
        setAccounts(data.accounts);
        setTransactions(data.transactions);
      }
    } catch {
      // Leave whatever was already loaded in place.
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function connectSimpleFin() {
    if (!setupToken.trim()) return;
    setConnecting(true);
    setStatus('');
    try {
      const res = await fetch('/api/simplefin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup_token: setupToken.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus('Connected! Syncing transactions...');
        setSetupToken('');
        await syncNow();
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch {
      setStatus('Something went wrong. Try again.');
    } finally {
      setConnecting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch('/api/simplefin/sync', {
        method: 'POST',
        headers: { 'x-internal': 'true' },
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(`Synced! ${data.added} transaction(s) imported across ${data.accounts} account(s).`);
        await loadDashboard();
      } else {
        setStatus(`Sync error: ${data.error}`);
      }
    } catch {
      setStatus('Sync failed. Try again.');
    } finally {
      setSyncing(false);
    }
  }

  const cardStyle = {
    background: '#1a1a1a',
    borderRadius: 16,
    padding: '1.5rem',
    marginBottom: '1rem',
  };

  const btnStyle = (active: boolean, color = '#22c55e') => ({
    width: '100%',
    padding: '0.875rem',
    borderRadius: 10,
    border: 'none',
    background: active ? color : '#2a2a2a',
    color: active ? '#000' : '#555',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: active ? 'pointer' : 'not-allowed',
  } as React.CSSProperties);

  function formatMoney(amount: string | null, currency: string) {
    if (amount === null) return '—';
    const n = Number(amount);
    const formatted = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sign = n < 0 ? '-' : '';
    return `${sign}${currency === 'USD' ? '$' : currency === 'CAD' ? 'CA$' : currency + ' '}${formatted}`;
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#0f0f0f',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '2rem 1rem',
      maxWidth: 480,
      margin: '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: '#22c55e',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem',
        }}>💰</div>
        <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Budget</h1>
      </div>

      {/* Accounts */}
      {accounts.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem' }}>
            Accounts
          </h2>
          {accounts.map((a) => {
            const balance = a.current_balance === null ? 0 : Number(a.current_balance);
            return (
              <div key={a.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.6rem 0', borderBottom: '1px solid #2a2a2a',
              }}>
                <div>
                  <div style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 500 }}>{a.name}</div>
                  <div style={{ color: '#666', fontSize: '0.75rem' }}>{a.institution}</div>
                </div>
                <div style={{
                  color: balance < 0 ? '#ef4444' : '#22c55e',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                }}>
                  {formatMoney(a.current_balance, a.currency)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loadingData && accounts.length === 0 && (
        <div style={cardStyle}>
          <p style={{ color: '#666', fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>
            No accounts yet. Connect a bank below, or check "Sync Transactions Now" if you've already connected one.
          </p>
        </div>
      )}

      {/* SimpleFIN Setup */}
      <div style={cardStyle}>
        <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
          Connect Bank via SimpleFIN
        </h2>
        <p style={{ color: '#666', fontSize: '0.85rem', margin: '0 0 1rem' }}>
          Paste your SimpleFIN setup token from beta-bridge.simplefin.org
        </p>
        <input
          type="password"
          value={setupToken}
          onChange={(e) => setSetupToken(e.target.value)}
          placeholder="Paste setup token..."
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: '1.5px solid #2a2a2a',
            background: '#111',
            color: '#fff',
            fontSize: '0.9rem',
            boxSizing: 'border-box',
            marginBottom: '0.75rem',
            outline: 'none',
          }}
        />
        <button
          onClick={connectSimpleFin}
          disabled={connecting || !setupToken.trim()}
          style={btnStyle(!connecting && !!setupToken.trim())}
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>

      {/* Manual sync */}
      <div style={cardStyle}>
        <button
          onClick={syncNow}
          disabled={syncing}
          style={btnStyle(!syncing, '#1e3a2f')}
        >
          <span style={{ color: syncing ? '#555' : '#22c55e' }}>
            {syncing ? 'Syncing...' : '↻ Sync Transactions Now'}
          </span>
        </button>
      </div>

      {status && (
        <p style={{ color: '#22c55e', fontSize: '0.9rem', textAlign: 'center', marginTop: '1rem', marginBottom: '1rem' }}>
          {status}
        </p>
      )}

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem' }}>
            Recent Transactions
          </h2>
          {transactions.map((t) => {
            const amount = Number(t.amount);
            return (
              <div key={t.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.5rem 0', borderBottom: '1px solid #2a2a2a', gap: '0.75rem',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    color: '#fff', fontSize: '0.85rem', fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {t.description_clean || t.description_raw}
                    {t.pending && (
                      <span style={{ color: '#eab308', fontSize: '0.7rem', marginLeft: '0.4rem' }}>PENDING</span>
                    )}
                  </div>
                  <div style={{ color: '#666', fontSize: '0.75rem' }}>
                    {formatDate(t.posted_date)} · {t.account_name}
                  </div>
                </div>
                <div style={{
                  color: amount < 0 ? '#ef4444' : '#22c55e',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {formatMoney(t.amount, t.currency)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <a href="/api/health" style={{ color: '#444', fontSize: '0.8rem' }}>
          Check database →
        </a>
      </div>
    </main>
  );
}
