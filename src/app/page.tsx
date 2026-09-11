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
  merchant_name: string | null;
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

interface NextPayday {
  amount: number;
  date: string;
  daysUntil: number;
}

interface SafeToSpend {
  amount: number;
  spendableBalance: number;
  essentialRemaining: number;
}

interface ForecastDay {
  date: string;
  balance: number;
  events: { label: string; amount: number }[];
}

interface Forecast {
  startingBalance: number;
  avgDailyBurn: number;
  days: ForecastDay[];
  lowest: ForecastDay;
  firstShortfall: ForecastDay | null;
}

interface TfsaStatus {
  hasRoomSet: boolean;
  asOfDate: string | null;
  asOfAmount: number | null;
  accruedSinceAsOf: number;
  contributionsSinceAsOf: number;
  withdrawalsRestoredSinceAsOf: number;
  pendingRestoration: number;
  currentRoom: number | null;
  isOverContributed: boolean;
  unverifiedLimitYears: number[];
}

interface SubscriptionEntry {
  merchant: string;
  source: 'category' | 'pattern';
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' | 'irregular';
  occurrences: { date: string; amount: number }[];
  lastAmount: number;
  previousAmount: number | null;
  priceIncreasePct: number | null;
  isPriceCreep: boolean;
  estimatedMonthly: number;
}

interface ChartSpec {
  type: 'bar' | 'pie';
  title: string;
  labels: string[];
  values: number[];
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
  const [reauth, setReauth] = useState<{ message: string; url: string } | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [monthTotals, setMonthTotals] = useState<MonthTotals>({ spent: '0', income: '0' });
  const [nextPayday, setNextPayday] = useState<NextPayday | null>(null);
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [tfsa, setTfsa] = useState<TfsaStatus | null>(null);
  const [showTfsaSetup, setShowTfsaSetup] = useState(false);
  const [tfsaDateInput, setTfsaDateInput] = useState('');
  const [tfsaAmountInput, setTfsaAmountInput] = useState('');
  const [savingTfsa, setSavingTfsa] = useState(false);
  const [subscriptions, setSubscriptions] = useState<SubscriptionEntry[]>([]);
  const [subsTotalMonthly, setSubsTotalMonthly] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null); // "YYYY-MM", set from server response
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  const [showAskAI, setShowAskAI] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ answer: string; chart: ChartSpec | null } | null>(null);

  async function loadDashboard(month?: string) {
    setLoadingData(true);
    try {
      const url = month ? `/api/dashboard?month=${month}` : '/api/dashboard';
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) {
        setAccounts(data.accounts);
        setTransactions(data.transactions);
        setCategoryOptions(data.categoryOptions);
        setBudgets(data.budgets);
        setMonthTotals(data.monthTotals);
        setNextPayday(data.nextPayday);
        setSafeToSpend(data.safeToSpend);
        setSelectedMonth(data.month);
      }
    } catch {
      // Leave whatever was already loaded in place.
    } finally {
      setLoadingData(false);
    }
  }

  async function loadForecast() {
    try {
      const res = await fetch('/api/forecast');
      const data = await res.json();
      if (data.ok) setForecast(data);
    } catch {
      // Leave whatever was already loaded in place.
    }
  }

  async function loadTfsa() {
    try {
      const res = await fetch('/api/tfsa');
      const data = await res.json();
      if (data.ok) setTfsa(data);
    } catch {
      // Leave whatever was already loaded in place.
    }
  }

  async function saveTfsaRoom() {
    const amount = Number(tfsaAmountInput);
    if (!tfsaDateInput || !Number.isFinite(amount) || amount < 0) {
      setStatus('Enter a valid date and a non-negative room amount.');
      return;
    }
    setSavingTfsa(true);
    try {
      const res = await fetch('/api/tfsa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOfDate: tfsaDateInput, amount }),
      });
      const data = await res.json();
      if (data.ok) {
        setTfsa(data);
        setShowTfsaSetup(false);
      } else {
        setStatus(`Could not save TFSA room: ${data.error}`);
      }
    } catch {
      setStatus('Could not save TFSA room. Try again.');
    } finally {
      setSavingTfsa(false);
    }
  }

  async function loadSubscriptions() {
    try {
      const res = await fetch('/api/subscriptions');
      const data = await res.json();
      if (data.ok) {
        setSubscriptions(data.subscriptions);
        setSubsTotalMonthly(data.totalMonthly);
      }
    } catch {
      // Leave whatever was already loaded in place.
    }
  }

  async function dismissSubscription(merchant: string) {
    setSubscriptions((prev) => prev.filter((s) => s.merchant !== merchant));
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubscriptions(data.subscriptions);
        setSubsTotalMonthly(data.totalMonthly);
      }
    } catch {
      // Already removed it optimistically -- a stale list on failure is
      // fine, the next full reload will reconcile.
    }
  }

  useEffect(() => {
    loadDashboard();
    loadForecast();
    loadTfsa();
    loadSubscriptions();
  }, []);

  function changeMonth(delta: number) {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    loadDashboard(next);
  }

  const currentRealMonth = (() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  })();

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
        setReauth(data.needsReauth ? { message: data.reauthMessage, url: data.reauthUrl } : null);
        await Promise.all([loadDashboard(selectedMonth ?? undefined), loadForecast(), loadTfsa(), loadSubscriptions()]);
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
      await loadDashboard(selectedMonth ?? undefined);
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
        await loadDashboard(selectedMonth ?? undefined);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch {
      setStatus('Could not update budget. Try again.');
    } finally {
      setSavingBudget(false);
    }
  }

  async function askAI(preset?: string) {
    if (!preset && !aiQuestion.trim()) return;
    setAiLoading(true);
    setAiError('');
    setAiResult(null);
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset ? { preset } : { question: aiQuestion.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setAiResult({ answer: data.answer, chart: data.chart });
      } else {
        setAiError(data.error || 'Something went wrong.');
      }
    } catch {
      setAiError('Could not reach the AI. Try again.');
    } finally {
      setAiLoading(false);
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
    // posted_date comes back as a full ISO timestamp (e.g.
    // "2026-09-06T06:00:00.000Z"), not a bare date -- format in UTC so the
    // calendar date shown matches what's stored, regardless of the
    // viewer's local timezone offset.
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function budgetColor(spent: number, limit: number) {
    const pct = limit > 0 ? spent / limit : 0;
    if (pct >= 1) return RED;
    if (pct >= 0.8) return YELLOW;
    return GREEN;
  }

  function renderForecastChart(f: Forecast) {
    const width = 600;
    const height = 160;
    const padY = 16;
    const balances = f.days.map((d) => d.balance);
    const maxBal = Math.max(...balances, 0);
    const minBal = Math.min(...balances, 0);
    const range = maxBal - minBal || 1;
    const x = (i: number) => (i / (f.days.length - 1)) * width;
    const y = (bal: number) => height - padY - ((bal - minBal) / range) * (height - 2 * padY);

    const linePath = f.days.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.balance).toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${x(f.days.length - 1).toFixed(1)} ${y(0).toFixed(1)} L 0 ${y(0).toFixed(1)} Z`;
    const zeroY = y(0);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {minBal < 0 && (
          <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={RED} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
        )}
        <path d={areaPath} fill={f.firstShortfall ? RED : GREEN} opacity={0.08} />
        <path d={linePath} fill="none" stroke={f.firstShortfall ? RED : GREEN} strokeWidth={2} />
        {f.days.map((d, i) => d.events.length > 0 && (
          <circle
            key={d.date}
            cx={x(i)}
            cy={y(d.balance)}
            r={3}
            fill={d.events[0].amount > 0 ? GREEN : YELLOW}
          />
        ))}
      </svg>
    );
  }

  const CHART_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#a855f7', '#ef4444', '#14b8a6', '#f97316'];

  function renderChart(chart: ChartSpec) {
    const max = Math.max(...chart.values, 0.01);
    if (chart.type === 'bar') {
      return (
        <div style={{ marginTop: '0.75rem' }}>
          {chart.title && <p style={{ color: MUTED, fontSize: '0.75rem', margin: '0 0 0.6rem' }}>{chart.title}</p>}
          {chart.labels.map((label, i) => (
            <div key={label} style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                <span style={{ color: '#ddd' }}>{label}</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{formatMoney(chart.values[i])}</span>
              </div>
              <div style={{ height: 6, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(2, (chart.values[i] / max) * 100)}%`,
                  background: CHART_COLORS[i % CHART_COLORS.length],
                  borderRadius: 3,
                }} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Pie: a CSS conic-gradient ring plus a swatch legend -- no chart library needed.
    const total = chart.values.reduce((s, v) => s + v, 0) || 1;
    let cursor = 0;
    const stops = chart.values.map((v, i) => {
      const start = (cursor / total) * 360;
      cursor += v;
      const end = (cursor / total) * 360;
      return `${CHART_COLORS[i % CHART_COLORS.length]} ${start}deg ${end}deg`;
    });
    return (
      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{
          width: 120, height: 120, borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(${stops.join(', ')})`,
        }} />
        <div style={{ flex: 1, minWidth: 140 }}>
          {chart.title && <p style={{ color: MUTED, fontSize: '0.75rem', margin: '0 0 0.5rem' }}>{chart.title}</p>}
          {chart.labels.map((label, i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', fontSize: '0.78rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
              <span style={{ color: '#ddd', flex: 1 }}>{label}</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>{formatMoney(chart.values[i])}</span>
            </div>
          ))}
        </div>
      </div>
    );
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

  function formatMonthLabel(ym: string | null) {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const totalBudget = budgets.reduce((sum, b) => sum + Number(b.amount), 0);
  const totalSpentAgainstBudget = budgets.reduce((sum, b) => sum + Number(b.spent), 0);

  return (
    <main className="shell" style={{ minHeight: '100vh', background: BG, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{`
        .shell {
          max-width: min(96vw, 1600px);
          margin: 0 auto;
          padding: clamp(1.5rem, 3vw, 2.5rem) clamp(1rem, 3vw, 2rem) 3rem;
        }
        /* No fixed breakpoints -- auto-fit recalculates the column count
           off the shell's actual rendered width continuously, so dragging
           the window (e.g. snapping it to half a laptop screen) collapses
           or restores the two-column layout smoothly instead of only at a
           couple of fixed pixel widths. minmax(min(340px, 100%), 1fr)
           is the safe form of this pattern -- plain minmax(340px, 1fr)
           would force a 340px-wide column even in a narrower viewport and
           cause horizontal overflow on a small phone. */
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
          gap: 1.5rem;
          align-items: start;
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: GREEN,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem',
        }}>💰</div>
        <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Budget</h1>
      </div>

      {/* Safe to Spend hero number */}
      {safeToSpend && (
        <div style={{ ...cardStyle, textAlign: 'center', background: '#0f1f18', border: `1px solid ${GREEN}` }}>
          <div style={{ color: MUTED, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Safe to Spend
          </div>
          <div style={{ color: safeToSpend.amount < 0 ? RED : GREEN, fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.2 }}>
            {formatMoney(safeToSpend.amount)}
          </div>
          <div style={{ color: MUTED, fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {formatMoney(safeToSpend.spendableBalance)} in checking − {formatMoney(safeToSpend.essentialRemaining)} left on rent/subscriptions this month
          </div>
        </div>
      )}

      {/* Cash-flow forecast */}
      {forecast && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
            <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: 0 }}>45-Day Cash Flow</h2>
            <span style={{ color: MUTED, fontSize: '0.75rem' }}>−{formatMoney(forecast.avgDailyBurn)}/day avg</span>
          </div>
          {renderForecastChart(forecast)}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem', fontSize: '0.8rem' }}>
            <span style={{ color: MUTED }}>
              Lowest: <span style={{ color: forecast.lowest.balance < 0 ? RED : '#ddd', fontWeight: 600 }}>{formatMoney(forecast.lowest.balance)}</span> on {formatDate(forecast.lowest.date)}
            </span>
          </div>
          {forecast.firstShortfall && (
            <p style={{ color: RED, fontSize: '0.8rem', marginTop: '0.5rem', marginBottom: 0 }}>
              ⚠ Projected to go negative around {formatDate(forecast.firstShortfall.date)} at this pace.
            </p>
          )}
          <p style={{ color: MUTED, fontSize: '0.7rem', marginTop: '0.5rem', marginBottom: 0 }}>
            Green dots = paycheck, yellow dots = rent. Everything else is smoothed from your trailing 30-day average spend — a rough projection, not a guarantee.
          </p>
        </div>
      )}

      {/* TFSA contribution room */}
      <div style={cardStyle}>
        <div
          onClick={() => setShowTfsaSetup(!showTfsaSetup)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: 0 }}>TFSA Contribution Room</h2>
          <span style={{ color: MUTED, fontSize: '0.8rem' }}>{showTfsaSetup ? '−' : tfsa?.hasRoomSet ? 'Edit' : '+'}</span>
        </div>

        {tfsa?.hasRoomSet && !showTfsaSetup && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ color: tfsa.isOverContributed ? RED : GREEN, fontSize: '1.8rem', fontWeight: 700 }}>
              {formatMoney(tfsa.currentRoom)}
            </div>
            <div style={{ color: MUTED, fontSize: '0.75rem', marginTop: '0.15rem' }}>
              room remaining, estimated from {formatMoney(tfsa.asOfAmount)} as of {tfsa.asOfDate ? formatDate(tfsa.asOfDate) : ''}
            </div>
            {tfsa.isOverContributed && (
              <p style={{ color: RED, fontSize: '0.8rem', marginTop: '0.5rem', marginBottom: 0 }}>
                ⚠ This estimate is negative — CRA charges 1%/month on TFSA over-contributions. Double-check against CRA My Account before contributing more.
              </p>
            )}
            {tfsa.pendingRestoration > 0 && (
              <p style={{ color: MUTED, fontSize: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
                {formatMoney(tfsa.pendingRestoration)} withdrawn this year restores to your room on Jan 1 next year, not before.
              </p>
            )}
            {tfsa.unverifiedLimitYears.length > 0 && (
              <p style={{ color: YELLOW, fontSize: '0.7rem', marginTop: '0.5rem', marginBottom: 0 }}>
                Annual limit not confirmed for {tfsa.unverifiedLimitYears.join(', ')} — using a $7,000 placeholder, verify with CRA.
              </p>
            )}
            <p style={{ color: MUTED, fontSize: '0.7rem', marginTop: '0.5rem', marginBottom: 0 }}>
              Planning estimate only, not tax advice — every dollar in or out of your TFSA counts here, including interest. Reconcile with CRA My Account periodically.
            </p>
          </div>
        )}

        {showTfsaSetup && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: MUTED, fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
              Enter your contribution room from CRA My Account and the date you checked it — everything since is estimated from your synced transactions.
            </p>
            <input
              type="date"
              value={tfsaDateInput}
              onChange={(e) => setTfsaDateInput(e.target.value)}
              style={{
                width: '100%', padding: '0.75rem 1rem', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, background: '#111', color: '#fff',
                fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: '0.5rem', outline: 'none',
              }}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={tfsaAmountInput}
              onChange={(e) => setTfsaAmountInput(e.target.value)}
              placeholder="Room amount as of that date"
              style={{
                width: '100%', padding: '0.75rem 1rem', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, background: '#111', color: '#fff',
                fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: '0.75rem', outline: 'none',
              }}
            />
            <button
              onClick={saveTfsaRoom}
              disabled={savingTfsa || !tfsaDateInput || !tfsaAmountInput}
              style={btnStyle(!savingTfsa && !!tfsaDateInput && !!tfsaAmountInput)}
            >
              {savingTfsa ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}

        {!tfsa?.hasRoomSet && !showTfsaSetup && (
          <p style={{ color: MUTED, fontSize: '0.8rem', margin: '0.75rem 0 0' }}>
            Set your contribution room from CRA My Account to start tracking.
          </p>
        )}
      </div>

      {/* Subscriptions */}
      {subscriptions.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
            <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: 0 }}>Subscriptions</h2>
            <span style={{ color: MUTED, fontSize: '0.75rem' }}>~{formatMoney(subsTotalMonthly)}/mo</span>
          </div>
          {subscriptions.map((s) => (
            <div
              key={s.merchant}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.6rem 0', borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <div>
                <div style={{ color: '#fff', fontSize: '0.85rem' }}>{s.merchant}</div>
                <div style={{ color: MUTED, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                  {s.cadence === 'irregular' ? 'not enough history yet' : s.cadence}
                  {s.source === 'pattern' ? ' · detected, not tagged as Subscription' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: s.isPriceCreep ? RED : '#ddd', fontSize: '0.9rem', fontWeight: 600 }}>
                    {formatMoney(s.lastAmount)}
                  </div>
                  {s.priceIncreasePct !== null && (
                    <div style={{ color: s.isPriceCreep ? RED : MUTED, fontSize: '0.7rem' }}>
                      {s.priceIncreasePct > 0 ? '+' : ''}{s.priceIncreasePct}% vs last
                    </div>
                  )}
                </div>
                <button
                  onClick={() => dismissSubscription(s.merchant)}
                  title="Cancelled — remove from this list"
                  style={{
                    background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6,
                    color: MUTED, fontSize: '0.75rem', width: 22, height: 22, lineHeight: 1,
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <p style={{ color: MUTED, fontSize: '0.7rem', marginTop: '0.6rem', marginBottom: 0 }}>
            Built from your transaction history — merchants tagged "Subscriptions" always show up; other recurring monthly+ charges only show up once there's a consistent pattern. Price-creep flags need at least two charges to compare.
          </p>
        </div>
      )}

      {/* Ask AI */}
      <div style={cardStyle}>
        <div
          onClick={() => setShowAskAI(!showAskAI)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <h2 style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, margin: 0 }}>✨ Ask AI</h2>
          <span style={{ color: MUTED, fontSize: '0.8rem' }}>{showAskAI ? '−' : '+'}</span>
        </div>

        {showAskAI && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {[
                { key: 'trends', label: 'Spending trends' },
                { key: 'budget_risks', label: 'Budget risks' },
                { key: 'category_breakdown', label: 'Category breakdown' },
              ].map((p) => (
                <button
                  key={p.key}
                  onClick={() => askAI(p.key)}
                  disabled={aiLoading}
                  style={{
                    padding: '0.5rem 0.85rem', borderRadius: 8, border: `1px solid ${BORDER}`,
                    background: '#111', color: aiLoading ? '#555' : '#ddd', fontSize: '0.8rem',
                    cursor: aiLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && askAI()}
                placeholder="Ask about your spending..."
                style={{
                  flex: 1, padding: '0.65rem 0.85rem', borderRadius: 8, border: `1px solid ${BORDER}`,
                  background: '#111', color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box', outline: 'none',
                }}
              />
              <button
                onClick={() => askAI()}
                disabled={aiLoading || !aiQuestion.trim()}
                style={{
                  padding: '0.65rem 1.1rem', borderRadius: 8, border: 'none',
                  background: aiLoading || !aiQuestion.trim() ? '#2a2a2a' : GREEN,
                  color: aiLoading || !aiQuestion.trim() ? '#555' : '#000',
                  fontSize: '0.85rem', fontWeight: 600,
                  cursor: aiLoading || !aiQuestion.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Ask
              </button>
            </div>

            {aiLoading && <p style={{ color: MUTED, fontSize: '0.85rem', marginTop: '0.75rem' }}>Thinking...</p>}
            {aiError && <p style={{ color: RED, fontSize: '0.85rem', marginTop: '0.75rem' }}>{aiError}</p>}
            {aiResult && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${BORDER}` }}>
                <p style={{ color: '#fff', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>{aiResult.answer}</p>
                {aiResult.chart && renderChart(aiResult.chart)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid">
      <div>

      {/* Month summary */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <button
            onClick={() => changeMonth(-1)}
            disabled={!selectedMonth}
            aria-label="Previous month"
            style={{ background: 'none', border: 'none', color: MUTED, fontSize: '1.1rem', cursor: selectedMonth ? 'pointer' : 'default', padding: '0 0.5rem' }}
          >
            ‹
          </button>
          <p style={{ color: MUTED, fontSize: '0.8rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {formatMonthLabel(selectedMonth)}
          </p>
          <button
            onClick={() => changeMonth(1)}
            disabled={!selectedMonth || selectedMonth >= currentRealMonth}
            aria-label="Next month"
            style={{
              background: 'none', border: 'none', fontSize: '1.1rem', padding: '0 0.5rem',
              color: (!selectedMonth || selectedMonth >= currentRealMonth) ? '#333' : MUTED,
              cursor: (!selectedMonth || selectedMonth >= currentRealMonth) ? 'default' : 'pointer',
            }}
          >
            ›
          </button>
        </div>
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
        {nextPayday && selectedMonth === currentRealMonth && (
          <div style={{ marginTop: '0.4rem', color: GREEN, fontSize: '0.75rem' }}>
            Next payday: {new Date(nextPayday.date + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}
            {nextPayday.daysUntil === 0 ? ' (today)' : ` (in ${nextPayday.daysUntil} day${nextPayday.daysUntil === 1 ? '' : 's'})`}
            {' · '}{formatMoney(nextPayday.amount)}
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
                      {t.merchant_name || t.description_clean || t.description_raw}
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

      {reauth && (
        <div
          style={{
            background: '#3a2f0f',
            border: `1px solid ${YELLOW}`,
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            margin: '0.5rem 0 1rem',
            textAlign: 'center',
            fontSize: '0.9rem',
          }}
        >
          <span style={{ color: YELLOW }}>⚠ Bank connection needs attention: {reauth.message}.</span>{' '}
          <a href={reauth.url} target="_blank" rel="noopener noreferrer" style={{ color: YELLOW, textDecoration: 'underline' }}>
            Reauthenticate at SimpleFIN →
          </a>
        </div>
      )}

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
