'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api, ApiError } from '@/lib/api/client';
import type { LedgerEntry, Reconciliation, Wallet } from '@/lib/api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Support usually has the caller's phone number, not their id — accept either. */
async function resolveUserId(input: string): Promise<string> {
  if (UUID.test(input)) return input;
  const user = await api.get<{ id: string }>(`/users/by-phone?phone=${encodeURIComponent(input)}`);
  return user.id;
}
import { formatDateTime } from '@/lib/format';
import { Card, EmptyNote, ErrorNote, Spinner, StatusBadge, Table } from './ui';

/**
 * "Why does this user's wallet say ₹X?" — the core support workflow.
 *
 * Given a user id, it pulls the cached balance, the append-only ledger that produced it, and a
 * live reconciliation of the two. Showing the reconciliation next to the balance is the point: it
 * answers not just "what is the balance" but "can we trust it" — an unreconciled wallet means a
 * write escaped the row lock, and support needs to see that in red, not discover it later.
 */
export function WalletOversight({ initialUserId = '' }: { initialUserId?: string }) {
  const [input, setInput] = useState(initialUserId);
  const [userId, setUserId] = useState(initialUserId);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const enabled = userId.length > 0;

  const wallet = useQuery({
    queryKey: ['wallet', userId],
    queryFn: () => api.get<Wallet>(`/admin/wallet/users/${userId}`),
    enabled,
  });

  const transactions = useQuery({
    queryKey: ['wallet-txns', userId],
    queryFn: () => api.get<LedgerEntry[]>(`/admin/wallet/users/${userId}/transactions`),
    enabled,
  });

  const reconciliation = useQuery({
    queryKey: ['wallet-reconcile', userId],
    queryFn: () => api.get<Reconciliation>(`/admin/wallet/users/${userId}/reconcile`),
    enabled,
  });

  const notFound =
    wallet.error instanceof ApiError && wallet.error.status === 404
      ? 'No wallet found for that user id.'
      : null;

  return (
    <div>
      <Card title="Look up a customer wallet">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setLookupError(null);
            resolveUserId(input.trim())
              .then(setUserId)
              .catch((err: unknown) => {
                setUserId('');
                setLookupError(
                  err instanceof ApiError && err.status === 404
                    ? 'No user with that phone number.'
                    : err instanceof Error
                      ? err.message
                      : 'Lookup failed.',
                );
              });
          }}
        >
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="wallet-user-id">Customer phone number or user id</label>
            <input
              id="wallet-user-id"
              className="input"
              placeholder="+91 98765 43210 or 00000000-0000-0000-0000-000000000000"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn--primary" disabled={input.trim().length === 0}>
            Look up
          </button>
        </form>
      </Card>

      {lookupError !== null && <p className="error">{lookupError}</p>}

      {!enabled && lookupError === null && (
        <EmptyNote>
          Enter a customer&rsquo;s phone number or user id to see their wallet history.
        </EmptyNote>
      )}

      {enabled && notFound !== null && <p className="error">{notFound}</p>}

      {enabled && notFound === null && (
        <>
          <Card
            title="Balance"
            actions={
              reconciliation.data !== undefined ? (
                <StatusBadge value={reconciliation.data.ok ? 'RECONCILED' : 'MISMATCH'} />
              ) : undefined
            }
          >
            {wallet.isLoading && <Spinner />}
            {wallet.error !== null && notFound === null && <ErrorNote error={wallet.error} />}
            {wallet.data !== undefined && (
              <div className="stat-grid">
                <div className="stat">
                  <div className="stat__value">{wallet.data.balanceRupees}</div>
                  <div className="stat__label">Cached balance</div>
                </div>
                {reconciliation.data !== undefined && (
                  <div className="stat">
                    <div className="stat__value">
                      {reconciliation.data.ok ? 'Trustworthy' : 'INVESTIGATE'}
                    </div>
                    <div className="stat__label">
                      Ledger replay {reconciliation.data.ok ? 'matches' : 'DISAGREES'} (
                      {reconciliation.data.entryCount} entries)
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card title="Ledger — every entry that moved this balance">
            {transactions.isLoading && <Spinner />}
            {transactions.error !== null && <ErrorNote error={transactions.error} />}
            {transactions.data !== undefined &&
              (transactions.data.length === 0 ? (
                <EmptyNote>No transactions yet.</EmptyNote>
              ) : (
                <Table<LedgerEntry>
                  rowKey={(row) => row.id}
                  rows={transactions.data}
                  columns={[
                    { header: 'When', cell: (r) => formatDateTime(r.createdAt) },
                    { header: 'Type', cell: (r) => <StatusBadge value={r.type} /> },
                    { header: 'Direction', cell: (r) => r.direction },
                    { header: 'Amount', cell: (r) => r.amountRupees },
                    { header: 'Balance after', cell: (r) => r.balanceAfterRupees },
                    { header: 'Note', cell: (r) => r.note ?? '—' },
                  ]}
                />
              ))}
          </Card>
        </>
      )}
    </div>
  );
}
