'use client';

import { useEffect, useState } from 'react';

interface Account {
  id: string;
  name: string;
  institution: string;
  type: string;
  currency: string;
  current_balance: string | null;
  balance_as_of: string | null;
  source: string;
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
  is_essential: boolean;
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

// ---- Icons (inline SVG, stroke-based, 24px grid) ----

function Icon({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const IconChevronLeft = (p: { size?: number }) => <Icon {...p}><polyline points="15 18 9 12 15 6" /></Icon>;
const IconChevronRight = (p: { size?: number }) => <Icon {...p}><polyline points="9 18 15 12 9 6" /></Icon>;
const IconChevronDown = (p: { size?: number }) => <Icon {...p}><polyline points="6 9 12 15 18 9" /></Icon>;
const IconRefresh = (p: { size?: number }) => <Icon {...p}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></Icon>;
const IconSun = (p: { size?: number }) => <Icon {...p}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></Icon>;
const IconMoon = (p: { size?: number }) => <Icon {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Icon>;
const IconAlertTriangle = (p: { size?: number }) => <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Icon>;
const IconClock = (p: { size?: number }) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Icon>;
const IconX = (p: { size?: number }) => <Icon {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>;
const IconSparkle = (p: { size?: number }) => <Icon {...p}><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" /></Icon>;
const IconCreditCard = (p: { size?: number }) => <Icon {...p}><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></Icon>;
const IconArrowUpRight = (p: { size?: number }) => <Icon {...p}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></Icon>;

// ---- Formatting helpers (no component state needed) ----

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

function formatMonthLabel(ym: string | null) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "Today" / "Yesterday" / "Sep 12" -- for grouping the transaction list by date. */
function groupLabel(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diffDays = Math.round((todayUTC - dUTC) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return formatDate(dateStr);
}

function budgetColor(spent: number, limit: number) {
  const pct = limit > 0 ? spent / limit : 0;
  if (pct >= 1) return 'var(--red)';
  if (pct >= 0.8) return 'var(--amber)';
  return 'var(--primary)';
}

const CHART_COLORS = ['var(--primary)', 'var(--green)', 'var(--amber)', '#a855f7', 'var(--red)', '#14b8a6', '#f97316'];

const cardStyle: React.CSSProperties = { borderRadius: 16, padding: '1.5rem', marginBottom: '1rem' };

function btnStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '0.875rem',
    borderRadius: 10,
    border: 'none',
    background: active ? 'var(--primary)' : 'var(--surface-2)',
    color: active ? 'var(--primary-on)' : 'var(--text-faint)',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: active ? 'pointer' : 'not-allowed',
  };
}

const iconBtnStyle = (size: number, radius = 10): React.CSSProperties => ({
  width: size, height: size, borderRadius: radius,
});

// For an icon button nested inside an already-bordered container (e.g. the
// month-nav pill) -- the .icon-btn class's own border/shadow would double up.
const nestedIconBtnStyle = (size: number, radius = 8): React.CSSProperties => ({
  width: size, height: size, borderRadius: radius, border: 'none', boxShadow: 'none', background: 'transparent',
});

export default function DashboardPage() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [setupToken, setSetupToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [reauth, setReauth] = useState<{ message: string; url: string } | null>(null);
  const [reauthDismissed, setReauthDismissed] = useState(false);
  const [staleDismissed, setStaleDismissed] = useState(false);

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

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('theme') : null;
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
    } else if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    window.localStorage.setItem('theme', next);
  }

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
        setReauthDismissed(false);
        setStaleDismissed(false);
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
    const lineColor = f.firstShortfall ? 'var(--red)' : 'var(--primary)';

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {minBal < 0 && (
          <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="var(--red)" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
        )}
        <path d={areaPath} fill={lineColor} opacity={0.1} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {f.days.map((d, i) => d.events.length > 0 && (
          <circle
            key={d.date}
            cx={x(i)}
            cy={y(d.balance)}
            r={3.5}
            fill={d.events[0].amount > 0 ? 'var(--green)' : 'var(--amber)'}
          />
        ))}
      </svg>
    );
  }

  function renderChart(chart: ChartSpec) {
    const max = Math.max(...chart.values, 0.01);
    if (chart.type === 'bar') {
      return (
        <div style={{ marginTop: '0.75rem' }}>
          {chart.title && <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 0.6rem' }}>{chart.title}</p>}
          {chart.labels.map((label, i) => (
            <div key={label} style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                <span style={{ color: 'var(--text)' }}>{label}</span>
                <span className="num" style={{ color: 'var(--text)', fontWeight: 600 }}>{formatMoney(chart.values[i])}</span>
              </div>
              <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
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
          {chart.title && <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 0.5rem' }}>{chart.title}</p>}
          {chart.labels.map((label, i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', fontSize: '0.78rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
              <span style={{ color: 'var(--text)', flex: 1 }}>{label}</span>
              <span className="num" style={{ color: 'var(--text)', fontWeight: 600 }}>{formatMoney(chart.values[i])}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const totalBudget = budgets.reduce((sum, b) => sum + Number(b.amount), 0);
  const totalSpentAgainstBudget = budgets.reduce((sum, b) => sum + Number(b.spent), 0);

  // SimpleFIN can return HTTP 200 with an empty errors array while its own
  // upstream bank scrape has stalled -- balance_as_of is SimpleFIN's own
  // balance-date (not our poll time), so this catches silent staleness that
  // never trips the `reauth` error-text detection above.
  const STALE_HOURS = 30;
  const staleAccounts = accounts.filter((a) => {
    if (a.source !== 'simplefin' || !a.balance_as_of) return false;
    return Date.now() - new Date(a.balance_as_of).getTime() > STALE_HOURS * 60 * 60 * 1000;
  });

  // Transactions arrive pre-sorted by posted_date desc, so consecutive rows
  // sharing a day-label collapse into one group without re-sorting.
  const txnGroups = transactions.reduce<{ label: string; items: Transaction[] }[]>((groups, t) => {
    const label = groupLabel(t.posted_date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(t);
    else groups.push({ label, items: [t] });
    return groups;
  }, []);

  const isErrorStatus = /error|failed|could not|something went wrong/i.test(status);

  return (
    <main className="shell" data-theme={theme} style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
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
        .accounts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
          gap: 1rem;
        }
        .budgets-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
          gap: 1.1rem 1.75rem;
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, background: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-on)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" />
            </svg>
          </div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.01em', margin: 0, color: 'var(--text)' }}>Budget</h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: 4, boxShadow: 'var(--shadow)' }}>
            <button onClick={() => changeMonth(-1)} disabled={!selectedMonth} className="icon-btn" style={nestedIconBtnStyle(34)} aria-label="Previous month">
              <IconChevronLeft />
            </button>
            <div className="num" style={{ fontWeight: 700, fontSize: '0.82rem', minWidth: 128, textAlign: 'center', color: 'var(--text)' }}>
              {formatMonthLabel(selectedMonth)}
            </div>
            <button onClick={() => changeMonth(1)} disabled={!selectedMonth || selectedMonth >= currentRealMonth} className="icon-btn" style={nestedIconBtnStyle(34)} aria-label="Next month">
              <IconChevronRight />
            </button>
          </div>

          <button onClick={syncNow} disabled={syncing} className="card" style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px', height: 42, borderRadius: 11,
            fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', cursor: syncing ? 'default' : 'pointer',
          }}>
            <span style={{ display: 'flex', color: 'var(--text-muted)', transform: syncing ? 'rotate(360deg)' : undefined, transition: 'transform 0.6s ease' }}>
              <IconRefresh />
            </span>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>

          <button onClick={toggleTheme} className="icon-btn" style={iconBtnStyle(42, 11)} aria-label="Toggle theme">
            {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
        </div>
      </div>

      {/* Banners */}
      {reauth && !reauthDismissed && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, background: 'var(--amber-soft)',
          border: '1px solid var(--amber-border)', borderRadius: 12, padding: '0.85rem 1rem', marginBottom: 12,
        }}>
          <span style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }}><IconAlertTriangle size={19} /></span>
          <div style={{ flex: 1, fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--text)' }}>
            <span style={{ fontWeight: 700 }}>Bank connection needs attention: </span>
            <span style={{ color: 'var(--text-muted)' }}>{reauth.message}.</span>{' '}
            <a href={reauth.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, textDecoration: 'none' }}>
              Reconnect →
            </a>
          </div>
          <button onClick={() => setReauthDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2 }} aria-label="Dismiss">
            <IconX size={15} />
          </button>
        </div>
      )}

      {(!reauth || reauthDismissed) && staleAccounts.length > 0 && !staleDismissed && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, background: 'var(--amber-soft)',
          border: '1px solid var(--amber-border)', borderRadius: 12, padding: '0.85rem 1rem', marginBottom: 12,
        }}>
          <span style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }}><IconClock size={19} /></span>
          <div style={{ flex: 1, fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--text)' }}>
            <span style={{ fontWeight: 700 }}>Bank data looks stale.</span>{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              {staleAccounts.map((a) => a.name).join(', ')} hasn't updated since{' '}
              {new Date(Math.min(...staleAccounts.map((a) => new Date(a.balance_as_of!).getTime()))).toLocaleString()}.
              SimpleFIN may not have re-scraped the bank yet.
            </span>
          </div>
          <button onClick={() => setStaleDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2 }} aria-label="Dismiss">
            <IconX size={15} />
          </button>
        </div>
      )}

      {/* Safe to Spend hero number */}
      {safeToSpend && (
        <div className="card" style={{ ...cardStyle, marginBottom: '1.5rem' }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            Safe to Spend
          </div>
          <div className="num" style={{
            fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '2.75rem', lineHeight: 1.15, letterSpacing: '-0.02em', marginTop: 8,
            color: safeToSpend.amount < 0 ? 'var(--red)' : 'var(--primary-strong)',
          }}>
            {formatMoney(safeToSpend.amount)}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            {formatMoney(safeToSpend.spendableBalance)} in checking − {formatMoney(safeToSpend.essentialRemaining)} left on rent/subscriptions this month
          </div>
        </div>
      )}

      {/* Cash-flow forecast */}
      {forecast && (
        <div className="card" style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.6rem' }}>
            <h2 style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 700, margin: 0 }}>45-Day Cash Flow</h2>
            <span className="num" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>−{formatMoney(forecast.avgDailyBurn)}/day avg</span>
          </div>
          {renderForecastChart(forecast)}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.7rem', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              Lowest: <span className="num" style={{ color: forecast.lowest.balance < 0 ? 'var(--red)' : 'var(--text)', fontWeight: 700 }}>{formatMoney(forecast.lowest.balance)}</span> on {formatDate(forecast.lowest.date)}
            </span>
          </div>
          {forecast.firstShortfall && (
            <div className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)', marginTop: '0.6rem' }}>
              <IconAlertTriangle size={12} />
              Projected to go negative around {formatDate(forecast.firstShortfall.date)} at this pace
            </div>
          )}
          <p style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginTop: '0.6rem', marginBottom: 0 }}>
            Green dots = paycheck, amber dots = rent. Everything else is smoothed from your trailing 30-day average spend — a rough projection, not a guarantee.
          </p>
        </div>
      )}

      {/* TFSA contribution room */}
      <div className="card" style={cardStyle}>
        <div
          onClick={() => setShowTfsaSetup(!showTfsaSetup)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <h2 style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 700, margin: 0 }}>TFSA Contribution Room</h2>
          {tfsa?.hasRoomSet && !showTfsaSetup ? (
            <span style={{ color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600 }}>Edit</span>
          ) : (
            <span style={{ color: 'var(--text-muted)', display: 'flex', transform: showTfsaSetup ? 'rotate(180deg)' : undefined }}>
              <IconChevronDown size={16} />
            </span>
          )}
        </div>

        {tfsa?.hasRoomSet && !showTfsaSetup && (
          <div style={{ marginTop: '0.85rem' }}>
            <div className="num" style={{ color: tfsa.isOverContributed ? 'var(--red)' : 'var(--primary-strong)', fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>
              {formatMoney(tfsa.currentRoom)}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
              room remaining, estimated from {formatMoney(tfsa.asOfAmount)} as of {tfsa.asOfDate ? formatDate(tfsa.asOfDate) : ''}
            </div>
            {tfsa.isOverContributed && (
              <div className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)', marginTop: '0.6rem' }}>
                <IconAlertTriangle size={12} />
                This estimate is negative — CRA charges 1%/month on TFSA over-contributions. Double-check against CRA My Account.
              </div>
            )}
            {tfsa.pendingRestoration > 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
                {formatMoney(tfsa.pendingRestoration)} withdrawn this year restores to your room on Jan 1 next year, not before.
              </p>
            )}
            {tfsa.unverifiedLimitYears.length > 0 && (
              <p style={{ color: 'var(--amber)', fontSize: '0.72rem', marginTop: '0.6rem', marginBottom: 0 }}>
                Annual limit not confirmed for {tfsa.unverifiedLimitYears.join(', ')} — using a $7,000 placeholder, verify with CRA.
              </p>
            )}
            <p style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginTop: '0.6rem', marginBottom: 0 }}>
              Planning estimate only, not tax advice — every dollar in or out of your TFSA counts here, including interest. Reconcile with CRA My Account periodically.
            </p>
          </div>
        )}

        {showTfsaSetup && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 0.6rem' }}>
              Enter your contribution room from CRA My Account and the date you checked it — everything since is estimated from your synced transactions.
            </p>
            <input
              type="date"
              value={tfsaDateInput}
              onChange={(e) => setTfsaDateInput(e.target.value)}
              style={{
                width: '100%', padding: '0.75rem 1rem', borderRadius: 10,
                border: '1.5px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)',
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
                border: '1.5px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)',
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.85rem 0 0' }}>
            Set your contribution room from CRA My Account to start tracking.
          </p>
        )}
      </div>

      {/* Subscriptions */}
      {subscriptions.length > 0 && (
        <div className="card" style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.6rem' }}>
            <h2 style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 700, margin: 0 }}>Subscriptions</h2>
            <span className="num" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>~{formatMoney(subsTotalMonthly)}/mo</span>
          </div>
          {subscriptions.map((s) => (
            <div
              key={s.merchant}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '0.7rem 0', borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--text)', fontSize: '0.87rem', fontWeight: 600 }}>{s.merchant}</div>
                <div style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                  {s.cadence === 'irregular' ? 'not enough history yet' : s.cadence}
                  {s.source === 'pattern' ? ' · detected, not tagged as Subscription' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                {s.isPriceCreep && (
                  <div className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>
                    <IconArrowUpRight size={11} />
                    {s.priceIncreasePct !== null ? `+${s.priceIncreasePct}%` : 'up'}
                  </div>
                )}
                <div className="num" style={{ color: 'var(--text)', fontSize: '0.92rem', fontWeight: 700, minWidth: 70, textAlign: 'right' }}>
                  {formatMoney(s.lastAmount)}
                </div>
                <button
                  onClick={() => dismissSubscription(s.merchant)}
                  title="Cancelled — remove from this list"
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                    color: 'var(--text-faint)', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <IconX size={13} />
                </button>
              </div>
            </div>
          ))}
          <p style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginTop: '0.7rem', marginBottom: 0 }}>
            Built from your transaction history — merchants tagged "Subscriptions" always show up; other recurring monthly+ charges only show up once there's a consistent pattern. Price-creep flags need at least two charges to compare.
          </p>
        </div>
      )}

      {/* Ask AI */}
      <div className="card" style={cardStyle}>
        <div
          onClick={() => setShowAskAI(!showAskAI)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <h2 style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--primary)', display: 'flex' }}><IconSparkle size={16} /></span>
            Ask AI
          </h2>
          <span style={{ color: 'var(--text-muted)', display: 'flex', transform: showAskAI ? 'rotate(180deg)' : undefined }}>
            <IconChevronDown size={16} />
          </span>
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
                    padding: '0.5rem 0.9rem', borderRadius: 999, border: '1px solid var(--border)',
                    background: 'var(--surface)', color: aiLoading ? 'var(--text-faint)' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600,
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
                  flex: 1, padding: '0.7rem 0.9rem', borderRadius: 10, border: '1px solid var(--border)',
                  background: 'var(--surface-2)', color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box', outline: 'none',
                }}
              />
              <button
                onClick={() => askAI()}
                disabled={aiLoading || !aiQuestion.trim()}
                style={{
                  padding: '0.7rem 1.1rem', borderRadius: 10, border: 'none',
                  background: aiLoading || !aiQuestion.trim() ? 'var(--surface-2)' : 'var(--primary)',
                  color: aiLoading || !aiQuestion.trim() ? 'var(--text-faint)' : 'var(--primary-on)',
                  fontSize: '0.85rem', fontWeight: 700,
                  cursor: aiLoading || !aiQuestion.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Ask
              </button>
            </div>

            {aiLoading && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>Thinking...</p>}
            {aiError && <p style={{ color: 'var(--red)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{aiError}</p>}
            {aiResult && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <p style={{ color: 'var(--text)', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>{aiResult.answer}</p>
                {aiResult.chart && renderChart(aiResult.chart)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid">
      <div>

      {/* Month summary */}
      <div className="card" style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Spent</div>
            <div className="num" style={{ color: 'var(--text)', fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>{formatMoney(monthTotals.spent)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Income</div>
            <div className="num" style={{ color: 'var(--green)', fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>{formatMoney(monthTotals.income)}</div>
          </div>
        </div>
        {totalBudget > 0 && (
          <div className="num" style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            {formatMoney(totalSpentAgainstBudget)} of {formatMoney(totalBudget)} budgeted
          </div>
        )}
        {nextPayday && selectedMonth === currentRealMonth && (
          <div className="num" style={{ marginTop: '0.4rem', color: 'var(--green)', fontSize: '0.78rem' }}>
            Next payday: {new Date(nextPayday.date + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}
            {nextPayday.daysUntil === 0 ? ' (today)' : ` (in ${nextPayday.daysUntil} day${nextPayday.daysUntil === 1 ? '' : 's'})`}
            {' · '}{formatMoney(nextPayday.amount)}
          </div>
        )}
      </div>

      {/* Budget progress */}
      {budgets.length > 0 && (
        <div className="card" style={cardStyle}>
          <h2 style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem' }}>Budgets</h2>
          <div className="budgets-grid">
            {budgets.map((b) => {
              const spent = Number(b.spent);
              const limit = Number(b.amount);
              const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
              const color = budgetColor(spent, limit);
              const isEditing = editingBudgetId === b.category_id;
              return (
                <div key={b.category_id}>
                  <div
                    onClick={() => {
                      if (isEditing) return;
                      setEditingBudgetId(b.category_id);
                      setBudgetInput(String(limit));
                    }}
                    style={{ cursor: isEditing ? 'default' : 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--text)', fontSize: '0.85rem', fontWeight: 700 }}>{b.category_name}</span>
                        {b.is_essential && (
                          <span className="chip" style={{ background: 'var(--primary-soft)', color: 'var(--primary-strong)', padding: '2px 8px', fontSize: '0.62rem' }}>
                            Essential
                          </span>
                        )}
                      </span>
                      <span className="num" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        {formatMoney(spent)} <span style={{ color: 'var(--text-faint)' }}>/ {formatMoney(limit)}</span>
                      </span>
                    </div>
                    <div style={{ height: 7, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4 }} />
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
                          flex: 1, padding: '0.5rem', borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--surface-2)', color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                        }}
                      />
                      <button
                        onClick={() => saveBudgetLimit(b.category_id)}
                        disabled={savingBudget}
                        style={{
                          padding: '0.5rem 0.9rem', borderRadius: 8, border: 'none',
                          background: 'var(--primary)', color: 'var(--primary-on)', fontSize: '0.85rem', fontWeight: 700,
                          cursor: savingBudget ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingBudgetId(null)}
                        style={{
                          padding: '0.5rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)',
                          background: 'none', color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer',
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
        </div>
      )}
      </div>

      <div>
      {/* Accounts */}
      {accounts.length > 0 && (
        <div className="card" style={cardStyle}>
          <h2 style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem' }}>Accounts</h2>
          <div className="accounts-grid">
            {accounts.map((a) => {
              const balance = a.current_balance === null ? 0 : Number(a.current_balance);
              // A negative balance is normal for a credit account (money
              // owed); it's only a real warning on a depository account
              // (an overdraft).
              const isOverdraft = balance < 0 && a.type !== 'credit';
              return (
                <div key={a.id} style={{
                  border: '1px solid var(--border)', borderRadius: 12, padding: '0.9rem 1rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-faint)', marginBottom: 10 }}>
                    <IconCreditCard size={14} />
                  </div>
                  <div style={{ color: 'var(--text)', fontSize: '0.88rem', fontWeight: 700 }}>{a.name}</div>
                  <div style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginTop: 1, marginBottom: 10 }}>{a.institution}</div>
                  <div className="num" style={{ color: isOverdraft ? 'var(--red)' : 'var(--text)', fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>
                    {formatMoney(a.current_balance, a.currency)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loadingData && accounts.length === 0 && (
        <div className="card" style={cardStyle}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>
            No accounts yet. Connect a bank below.
          </p>
        </div>
      )}

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <div className="card" style={cardStyle}>
          <h2 style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Recent Transactions</h2>
          {txnGroups.map((grp) => (
            <div key={grp.label + grp.items[0].id} style={{ marginTop: '1rem' }}>
              <div style={{ color: 'var(--text-faint)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {grp.label}
              </div>
              {grp.items.map((t) => {
                const amount = Number(t.amount);
                const isEditing = editingTxnId === t.id;
                return (
                  <div key={t.id} style={{ borderTop: '1px solid var(--border)', padding: '0.6rem 0' }}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem',
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          color: 'var(--text)', fontSize: '0.87rem', fontWeight: 600,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {t.merchant_name || t.description_clean || t.description_raw}
                          {t.pending && <span style={{ color: 'var(--amber)', fontSize: '0.68rem', marginLeft: '0.4rem', fontWeight: 700 }}>PENDING</span>}
                        </div>
                        <div style={{
                          color: 'var(--text-faint)', fontSize: '0.75rem', marginTop: 3,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {t.account_name}
                        </div>
                      </div>
                      <div className="num" style={{ color: amount > 0 ? 'var(--green)' : 'var(--text)', fontSize: '0.87rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {formatMoney(t.amount, t.currency)}
                      </div>
                    </div>
                    <button
                      onClick={() => setEditingTxnId(isEditing ? null : t.id)}
                      className="chip"
                      style={{
                        background: t.category_name ? 'var(--surface-2)' : 'var(--primary-soft)',
                        color: t.category_name ? 'var(--text-muted)' : 'var(--primary-strong)',
                        border: 'none', cursor: 'pointer', marginTop: 8,
                      }}
                    >
                      {t.category_name ?? 'Uncategorized'}
                      <IconChevronDown size={10} />
                    </button>
                    {isEditing && (
                      <select
                        autoFocus
                        defaultValue={t.category_id ?? ''}
                        onChange={(e) => e.target.value && reassignCategory(t.id, e.target.value)}
                        style={{
                          marginTop: '0.5rem', width: '100%', padding: '0.5rem',
                          borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)',
                          color: 'var(--text)', fontSize: '0.85rem',
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
          ))}
        </div>
      )}
      </div>
      </div>

      {status && (
        <p style={{ color: isErrorStatus ? 'var(--red)' : 'var(--green)', fontSize: '0.9rem', textAlign: 'center', margin: '1rem 0' }}>{status}</p>
      )}

      {/* Connect another bank */}
      <div className="card" style={cardStyle}>
        {!showConnect && (
          <button
            onClick={() => setShowConnect(true)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer', width: '100%', fontWeight: 600 }}
          >
            + Connect another bank
          </button>
        )}

        {showConnect && (
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 0.6rem' }}>
              Paste a SimpleFIN setup token from beta-bridge.simplefin.org
            </p>
            <input
              type="password"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="Paste setup token..."
              style={{
                width: '100%', padding: '0.75rem 1rem', borderRadius: 10,
                border: '1.5px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)',
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
