'use client';

import { useState } from 'react';

export default function DashboardPage() {
  const [setupToken, setSetupToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('');

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
