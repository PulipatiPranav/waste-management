'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { DEMO_CREDENTIALS } from '@/lib/env';

export default function LoginPage() {
  const { status, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Do not show a login form.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    login(email, password)
      .then(() => router.replace('/'))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Login failed.');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="login">
      <h1>CPE Ops Console</h1>
      <p className="muted">Staff sign-in. Ops and admin accounts only.</p>

      {DEMO_CREDENTIALS !== null && (
        <div className="demo-note">
          <p>
            <strong>Public demo.</strong> Sign in as <code>{DEMO_CREDENTIALS.email}</code> /{' '}
            <code>{DEMO_CREDENTIALS.password}</code>. Data is sample data and may be reset.
          </p>
          <Button
            type="button"
            onClick={() => {
              setEmail(DEMO_CREDENTIALS?.email ?? '');
              setPassword(DEMO_CREDENTIALS?.password ?? '');
            }}
          >
            Use demo account
          </Button>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
