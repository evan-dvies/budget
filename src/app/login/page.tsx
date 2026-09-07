'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        setError('Wrong password. Try again.');
        setPassword('');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f0f0f', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '1rem',
    }}>
      <div style={{
        width: '100%', maxWidth: '360px', background: '#1a1a1a',
        borderRadius: '16px', padding: '2.5rem 2rem', boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '14px', background: '#22c55e',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.75rem', marginBottom: '1.5rem',
        }}>💰</div>
        <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Budget</h1>
        <p style={{ color: '#666', fontSize: '0.9rem', margin: '0 0 2rem' }}>Enter your password to continue</p>
        <input
          type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          placeholder="Password" autoFocus
          style={{
            width: '100%', padding: '0.875rem 1rem', borderRadius: '10px',
            border: error ? '1.5px solid #ef4444' : '1.5px solid #2a2a2a',
            background: '#111', color: '#fff', fontSize: '1rem', outline: 'none',
            boxSizing: 'border-box', marginBottom: '0.75rem',
          }}
        />
        {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}
        <button
          onClick={handleLogin} disabled={loading || !password}
          style={{
            width: '100%', padding: '0.875rem', borderRadius: '10px', border: 'none',
            background: loading || !password ? '#2a2a2a' : '#22c55e',
            color: loading || !password ? '#555' : '#000',
            fontSize: '1rem', fontWeight: 600,
            cursor: loading || !password ? 'not-allowed' : 'pointer',
          }}
        >{loading ? 'Checking...' : 'Unlock'}</button>
      </div>
    </main>
  );
}
