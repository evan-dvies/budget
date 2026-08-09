'use client';

import { useState } from 'react';

declare global {
  interface Window { Plaid: any; }
}

export default function DashboardPage() {
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState('');

  async function connectBank() {
    setConnecting(true);
    setStatus('');
    try {
      // 1. Get a link token from our API
      const res = await fetch('/api/plaid/create-link-token', { method: 'POST' });
      const { link_token, error } = await res.json();
      if (error) { setStatus('Could not start bank connection. Check your Plaid keys.'); return; }

      // 2. Load Plaid Link script if not already loaded
      if (!window.Plaid) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
          script.onload = () => resolve();
          script.onerror = () => reject();
          document.head.appendChild(script);
        });
      }

      // 3. Open Plaid Link
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token: string, metadata: any) => {
          setStatus('Saving connection...');
          const exchangeRes = await fetch('/api/plaid/exchange-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              public_token,
              institution_name: metadata?.institution?.name,
            }),
          });
          const result = await exchangeRes.json();
          if (result.ok) {
            setStatus('Bank connected! Syncing transactions...');
            await syncNow();
          } else {
            setStatus('Connection saved but sync failed. Try syncing manually.');
          }
        },
        onExit: () => {
          setStatus('');
          setConnecting(false);
        },
      });
      handler.open();
    } catch {
      setStatus('Something went wrong. Try again.');
    } finally {
      setConnecting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'x-internal': 'true' },
      });
      const data = await res.json();
      if (data.ok) {
        const total = data.results.reduce((sum: number, r: any) => sum + (r.added ?? 0), 0);
        setStatus(`Synced! ${total} new transaction(s) imported.`);
      } else {
        setStatus('Sync failed. Check Vercel logs.');
      }
    } catch {
      setStatus('Sync failed. Try again.');
    } finally {
      setSyncing(false);
    }
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

      <div style={{
        background: '#1a1a1a', borderRadius: 16, padding: '1.5rem', marginBottom: '1rem',
      }}>
        <p style={{ color: '#888', fontSize: '0.9rem', margin: '0 0 1rem' }}>
          Connect your bank account to start tracking transactions automatically.
        </p>
        <button
          onClick={connectBank}
          disabled={connecting}
          style={{
            width: '100%', padding: '0.875rem', borderRadius: 10, border: 'none',
            background: connecting ? '#2a2a2a' : '#22c55e',
            color: connecting ? '#555' : '#000',
            fontSize: '1rem', fontWeight: 600,
            cursor: connecting ? 'not-allowed' : 'pointer',
          }}
        >
          {connecting ? 'Opening...' : '+ Connect Bank Account'}
        </button>
      </div>

      <div style={{
        background: '#1a1a1a', borderRadius: 16, padding: '1.5rem', marginBottom: '1rem',
      }}>
        <button
          onClick={syncNow}
          disabled={syncing}
          style={{
            width: '100%', padding: '0.875rem', borderRadius: 10, border: 'none',
            background: syncing ? '#2a2a2a' : '#1e3a2f',
            color: syncing ? '#555' : '#22c55e',
            fontSize: '1rem', fontWeight: 600,
            cursor: syncing ? 'not-allowed' : 'pointer',
          }}
        >
          {syncing ? 'Syncing...' : '↻ Sync Transactions Now'}
        </button>
      </div>

      {status && (
        <p style={{ color: '#22c55e', fontSize: '0.9rem', textAlign: 'center', marginTop: '1rem' }}>
          {status}
        </p>
      )}

      <div style={{ marginTop: '2rem' }}>
        <a href="/api/health" style={{ color: '#444', fontSize: '0.8rem' }}>
          Check database →
        </a>
      </div>
    </main>
  );
}
