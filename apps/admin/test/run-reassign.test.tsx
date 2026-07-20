import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunReassign } from '@/components/run-reassign';
import type * as ApiClient from '@/lib/api/client';
import { renderWithQuery } from './render';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClient>();
  return { ...actual, api: mockApi };
});

const RUN_ID = 'run-1';
const ZONE_ID = 'zone-1';
const CURRENT_PARTNER = 'partner-current';
const ELIGIBLE_PARTNER = 'partner-eligible';

const RUN = {
  id: RUN_ID,
  runDate: '2026-07-17',
  zoneId: ZONE_ID,
  partnerId: CURRENT_PARTNER,
  status: 'PENDING',
  stops: [
    {
      id: 's1',
      subscriptionId: 'sub1',
      addressId: 'a1',
      status: 'PENDING',
      reason: null,
      sequence: 1,
      completedAt: null,
      photoUrl: null,
    },
  ],
};

const PARTNERS = [
  // Current assignee — must be excluded from the reassign options.
  {
    id: CURRENT_PARTNER,
    userId: 'u0',
    name: 'Current Rider',
    phone: '+910',
    kycStatus: 'VERIFIED',
    vehicleType: 'SCOOTER',
    isActive: true,
    isAvailable: true,
    zoneIds: [ZONE_ID],
  },
  // Eligible.
  {
    id: ELIGIBLE_PARTNER,
    userId: 'u1',
    name: 'Spare Rider',
    phone: '+911',
    kycStatus: 'VERIFIED',
    vehicleType: 'BICYCLE',
    isActive: true,
    isAvailable: true,
    zoneIds: [ZONE_ID],
  },
  // Ineligible: not available.
  {
    id: 'partner-busy',
    userId: 'u2',
    name: 'Busy Rider',
    phone: '+912',
    kycStatus: 'VERIFIED',
    vehicleType: 'CAR',
    isActive: true,
    isAvailable: false,
    zoneIds: [ZONE_ID],
  },
  // Ineligible: wrong zone.
  {
    id: 'partner-other-zone',
    userId: 'u3',
    name: 'Other Zone',
    phone: '+913',
    kycStatus: 'VERIFIED',
    vehicleType: 'CAR',
    isActive: true,
    isAvailable: true,
    zoneIds: ['zone-2'],
  },
];

describe('RunReassign — the delivery run reassignment support workflow', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    mockApi.get.mockImplementation((path: string) => {
      if (path === `/admin/delivery/runs/${RUN_ID}`) return Promise.resolve(RUN);
      if (path === '/admin/delivery/partners') return Promise.resolve(PARTNERS);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    mockApi.post.mockResolvedValue({ ...RUN, partnerId: ELIGIBLE_PARTNER });
  });

  it('offers only eligible partners (excludes current, unavailable, and out-of-zone)', async () => {
    renderWithQuery(<RunReassign runId={RUN_ID} />);

    const select = await screen.findByLabelText(/reassign to partner/i);
    const optionLabels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');

    expect(optionLabels.some((l) => l.includes('Spare Rider'))).toBe(true);
    expect(optionLabels.some((l) => l.includes('Current Rider'))).toBe(false);
    expect(optionLabels.some((l) => l.includes('Busy Rider'))).toBe(false);
    expect(optionLabels.some((l) => l.includes('Other Zone'))).toBe(false);
  });

  it('reassigns the run to the chosen partner', async () => {
    const user = userEvent.setup();
    renderWithQuery(<RunReassign runId={RUN_ID} />);

    const select = await screen.findByLabelText(/reassign to partner/i);
    await user.selectOptions(select, ELIGIBLE_PARTNER);
    await user.click(screen.getByRole('button', { name: /reassign run/i }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(`/admin/delivery/runs/${RUN_ID}/reassign`, {
        toPartnerId: ELIGIBLE_PARTNER,
      });
    });
    expect(await screen.findByText(/run reassigned/i)).toBeInTheDocument();
  });
});
