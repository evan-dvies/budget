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
  category_id: string | null;
  category_name: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  parent_name: string | null;
}

interface Budget {
  category_id: string;
  category_name: string;
  amount: string;
  spent: string;
}

interface MonthTotals {
  spent: string;
  income: string;
}

const BG = '#0f0f0f';
const CARD = '#1a1a1a';
const BORDER = '#2a2a2a';
const GREEN = '#22c55e';
const RED = '#ef4444';
const YELLOW = '#eab308';
const MUTED = '#666';

export default function DashboardPage() {
  const [setupToken, setSetupToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('');
  const [showConnect, setShowConnect] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [monthTotals, setMonthTotals] = useState<MonthTotals>({ spent: '0', income: '0' });
  const [loadingData, setLoadingData] = useState(true);
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  async function loadDashboard() {
    setLoadingData(true);
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      if (data.ok) {
        setAccounts(data.accounts);
        setTransactions(data.transactions);
        setCategoryOptions(data.categoryOptions);
        setBudgets(data.budgets);
        setMonthTotals(data.monthTotals);
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

  async function reassignCategory(txnId: string, categoryId: string) {
    setEditingTxnId(null);
    try {
      await fetch(`/api/transactions/${txnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId }),
      });
      await loadDashboard();
    } catch {
      setStatus('Could not update category. Try again.');
    }
  }

  async function saveBudgetLimit(categoryId: string) {
    const amount = Number(budgetInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus('Enter a valid amount greater than 0.');
      return;
    }
    setSavingBudget(true);
    try {
      const res = await fetch(`/api/budgets/${categoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (data.ok) {
        setEditingBudgetId(null);
        await loadDashboard();
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch {
      setStatus('Could not update budget. Try again.');
    } finally {
      setSavingBudget(false);
    }
  }

  function formatMoney(amount: string | number | null, currency = 'CAD') {
    if (amount === null) return '—';
    const n = Number(amount);
    const formatted = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sign = n < 0 ? '-' : '';
    const symbol = currency === 'USD' ? '$' : currency === 'CAD' ? 'CA$' : currency + ' ';
    return `${sign}${symbol}${formatted}`;
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function budgetColor(spent: number, limit: number) {
    const pct = limit > 0 ? spent / limit : 0;
    if (pct >= 1) return RED;
    if (pct >= 0.8) return YELLOW;
    return GREEN;
  }

  const cardStyle: React.CSSProperties = {
    background: CARD,
    borderRadius: 16,
    padding: '1.25rem',
    marginBottom: '1rem',
  };

  const btnStyle = (active: boolean, color = GREEN): React.CSSProperties => ({
    width: '100%',
    padding: '0.875rem',
    borderRadius: 10,
    border: 'none',
    background: active ? color : '#2a2a2a',
    color: active ? '#000' : '#555',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: active ? 'pointer' : 'not-allowed',
  });

  const monthName = new Date().toLocaleDateString(undefined, { month: 'long' });
  const totalBudget = budgets.reduce((sum, b) => sum + Number(b.amount), 0);
  const totalSpentAgainstBudget = budgets.reduce((sum, b) => sum + Number(b.spent), 0);

  return (
    <main className="shell" style={{ minHeight: '100vh', background: BG, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{`
        .shell {
          max-width: 480px;
          margin: 0 auto;
          padding: 1.5rem 1rem 3rem;
        }
        .grid {
          display: block;
        }
        /* Phone: single column at (or near) full width -- default styles. */
        /* Laptop: two columns, width scales with the window instead of a
           fixed cap, so it fills the screen instead of floating small. */
        @media (min-width: 700px) {
          .shell {
            max-width: min(92vw, 1100px);
            padding: 2.5rem 2rem 4rem;
          }
          .grid {
            display: grid;
            grid-template-columns: 400px 1fr;
            gap: 1.75rem;
            align-items: start;
          }
        }
        /* External monitor: a bit more room, still capped so lines of text
           don't stretch uncomfortably wide. */
        @media (min-width: 1600px) {
          .shell {
            max-width: 1360px;
          }
          .grid {
            grid-template-columns: 460px 1fr;
          }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: GREEN,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem',
        }}>💰</div>
        <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Budget</h1>
      </div>

      <div className="grid">
      <div>

      {/* Month summary */}
      <div style={cardStyle}>
        <p style={{ color: MUTED, fontSize: '0.8rem', margin: '0 0 0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {monthName}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: MUTED, fontSize: '0.8rem' }}>Spent</div>
            <div style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700 }}>{formatMoney(monthTotals.spent)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: MUTED, fontSize: '0.8rem' }}>Income</div>
            <div style={{ color: GREEN, fontSize: '1.5rem', fontWeight: 700 }}>{formatMoney(monthTotals.income)}</div>
          </div>
        </div>
        {totalBudget > 0 && (
          <div style={{ marginTop: '0.75rem', color: MUTED, fontSize: '0.75rem' }}>
            {formatMoney(totalSpentAgainstBudget)} of {formatMoney(totalBudget)} budgeted
          </div>
        )}
      </div>

      {/* Budget progress */}
      {budgets.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem' }}>Budgets</h2>
          {budgets.map((b) => {
            const spent = Number(b.spent);
            const limit = Number(b.amount);
            const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
            const color = budgetColor(spent, limit);
            const isEditing = editingBudgetId === b.category_id;
            return (
              <div key={b.category_id} style={{ marginBottom: '0.9rem' }}>
                <div
                  onClick={() => {
                    if (isEditing) return;
                    setEditingBudgetId(b.category_id);
                    setBudgetInput(String(limit));
                  }}
                  style={{ cursor: isEditing ? 'default' : 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 500 }}>{b.category_name}</span>
                    <span style={{ color, fontSize: '0.8rem', fontWeight: 600 }}>
                      {formatMoney(spent)} / {formatMoney(limit)}
                    </span>
                  </div>
                  <div style={{ height: 6, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
                  </div>
                </div>
                {isEditing && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input
                      autoFocus
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveBudgetLimit(b.category_id)}
                      style={{
                        flex: 1, padding: '0.5rem', borderRadius: 8, border: `1px solid ${BORDER}`,
                        background: '#111', color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box',
                      }}
                    />
                    <button
                      onClick={() => saveBudgetLimit(b.category_id)}
                      disabled={savingBudget}
                      style={{
                        padding: '0.5rem 0.9rem', borderRadius: 8, border: 'none',
                        background: GREEN, color: '#000', fontSize: '0.85rem', fontWeight: 600,
                        cursor: savingBudget ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingBudgetId(null)}
                      style={{
                        padding: '0.5rem 0.9rem', borderRadius: 8, border: `1px solid ${BORDER}`,
                        background: 'none', color: MUTED, fontSize: '0.85rem', cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>

      <div>
      {/* Accounts */}
      {accounts.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem' }}>Accounts</h2>
          {accounts.map((a) => {
            const balance = a.current_balance === null ? 0 : Number(a.current_balance);
            return (
              <div key={a.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.6rem 0', borderBottom: `1px solid ${BORDER}`,
              }}>
                <div>
                  <div style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 500 }}>{a.name}</div>
                  <div style={{ color: MUTED, fontSize: '0.75rem' }}>{a.institution}</div>
                </div>
                <div style={{ color: balance < 0 ? RED : GREEN, fontSize: '0.95rem', fontWeight: 600 }}>
                  {formatMoney(a.current_balance, a.currency)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loadingData && accounts.length === 0 && (
        <div style={cardStyle}>
          <p style={{ color: MUTED, fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>
            No accounts yet. Connect a bank below.
          </p>
        </div>
      )}

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem' }}>Recent Transactions</h2>
          {transactions.map((t) => {
            const amount = Number(t.amount);
            const isEditing = editingTxnId === t.id;
            return (
              <div key={t.id} style={{ borderBottom: `1px solid ${BORDER}`, padding: '0.5rem 0' }}>
                <div
                  onClick={() => setEditingTxnId(isEditing ? null : t.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: '0.75rem', cursor: 'pointer',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      color: '#fff', fontSize: '0.85rem', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {t.description_clean || t.description_raw}
                      {t.pending && <span style={{ color: YELLOW, fontSize: '0.7rem', marginLeft: '0.4rem' }}>PENDING</span>}
                    </div>
                    <div style={{ color: MUTED, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>{formatDate(t.posted_date)} · {t.account_name}</span>
                      <span style={{
                        background: BORDER, color: t.category_name ? '#ccc' : MUTED,
                        borderRadius: 6, padding: '0.1rem 0.4rem', fontSize: '0.68rem',
                      }}>
                        {t.category_name ?? 'Uncategorized'}
                      </span>
                    </div>
                  </div>
                  <div style={{ color: amount < 0 ? RED : GREEN, fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatMoney(t.amount, t.currency)}
                  </div>
                </div>
                {isEditing && (
                  <select
                    autoFocus
                    defaultValue={t.category_id ?? ''}
                    onChange={(e) => e.target.value && reassignCategory(t.id, e.target.value)}
                    style={{
                      marginTop: '0.5rem', width: '100%', padding: '0.5rem',
                      borderRadius: 8, border: `1px solid ${BORDER}`, background: '#111',
                      color: '#fff', fontSize: '0.85rem',
                    }}
                  >
                    <option value="" disabled>Choose a category…</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.parent_name} &gt; {c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
      </div>

      {status && (
        <p style={{ color: GREEN, fontSize: '0.9rem', textAlign: 'center', margin: '0.5rem 0 1rem' }}>{status}</p>
      )}

      {/* Connect / sync — collapsed by default once something is connected */}
      <div style={cardStyle}>
        <button onClick={syncNow} disabled={syncing} style={btnStyle(!syncing, '#1e3a2f')}>
          <span style={{ color: syncing ? '#555' : GREEN }}>{syncing ? 'Syncing...' : '↻ Sync Transactions Now'}</span>
        </button>

        {!showConnect && (
          <button
            onClick={() => setShowConnect(true)}
            style={{ background: 'none', border: 'none', color: MUTED, fontSize: '0.8rem', marginTop: '0.75rem', cursor: 'pointer', width: '100%' }}
          >
            + Connect another bank
          </button>
        )}

        {showConnect && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: MUTED, fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
              Paste a SimpleFIN setup token from beta-bridge.simplefin.org
            </p>
            <input
              type="password"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="Paste setup token..."
              style={{
                width: '100%', padding: '0.75rem 1rem', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, background: '#111', color: '#fff',
                fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: '0.75rem', outline: 'none',
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
        )}
      </div>
    </main>
  );
}
