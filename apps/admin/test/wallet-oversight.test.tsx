import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletOversight } from '@/components/wallet-oversight';
import type * as ApiClient from '@/lib/api/client';
import { renderWithQuery } from './render';

// Mock the API client but keep the real ApiError so the component's 404 branch works.
const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClient>();
  return { ...actual, api: mockApi };
});

const USER_ID = '11111111-2222-3333-4444-555555555555';

const WALLET = { id: 'w1', balancePaise: '48000', balanceRupees: '₹480.00', currency: 'INR' };
const TXNS = [
  {
    id: 't1',
    type: 'PICKUP_CASHBACK',
    direction: 'CREDIT',
    amountPaise: '48000',
    amountRupees: '₹480.00',
    balanceAfterPaise: '48000',
    balanceAfterRupees: '₹480.00',
    pickupId: 'p1',
    withdrawalId: null,
    note: 'Pickup #42',
    createdAt: '2026-07-10T09:00:00.000Z',
  },
];
const RECONCILE = {
  ok: true,
  cachedBalancePaise: '48000',
  ledgerBalancePaise: '48000',
  entryCount: 1,
  brokenAtIndex: null,
};

describe('WalletOversight — the "why does this wallet say ₹X" support workflow', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.get.mockImplementation((path: string) => {
      if (path === `/admin/wallet/users/${USER_ID}`) return Promise.resolve(WALLET);
      if (path === `/admin/wallet/users/${USER_ID}/transactions`) return Promise.resolve(TXNS);
      if (path === `/admin/wallet/users/${USER_ID}/reconcile`) return Promise.resolve(RECONCILE);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
  });

  it('does not fetch until a user id is searched', () => {
    renderWithQuery(<WalletOversight />);
    expect(mockApi.get).not.toHaveBeenCalled();
    expect(screen.getByText(/enter a customer/i)).toBeInTheDocument();
  });

  it('looks up the wallet, its ledger, and the reconciliation on search', async () => {
    const user = userEvent.setup();
    renderWithQuery(<WalletOversight />);

    await user.type(screen.getByLabelText(/customer user id/i), USER_ID);
    await user.click(screen.getByRole('button', { name: /look up/i }));

    // The ledger entry and its note render — the answer to "why does it say ₹480".
    expect(await screen.findByText('Pickup #42')).toBeInTheDocument();
    expect(screen.getAllByText('₹480.00').length).toBeGreaterThan(0);

    // All three oversight queries fired for that user.
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(`/admin/wallet/users/${USER_ID}`);
      expect(mockApi.get).toHaveBeenCalledWith(`/admin/wallet/users/${USER_ID}/transactions`);
      expect(mockApi.get).toHaveBeenCalledWith(`/admin/wallet/users/${USER_ID}/reconcile`);
    });

    // Reconciliation status is surfaced next to the balance.
    expect(screen.getByText('RECONCILED')).toBeInTheDocument();
  });

  it('shows a clean "not found" when the user has no wallet (404), not a crash', async () => {
    const { ApiError } = await import('@/lib/api/client');
    mockApi.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'not found'));

    const user = userEvent.setup();
    renderWithQuery(<WalletOversight />);
    await user.type(screen.getByLabelText(/customer user id/i), USER_ID);
    await user.click(screen.getByRole('button', { name: /look up/i }));

    expect(await screen.findByText(/no wallet found/i)).toBeInTheDocument();
  });
});
