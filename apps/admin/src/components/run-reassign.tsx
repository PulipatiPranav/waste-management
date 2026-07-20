'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import type { Partner, Run } from '@/lib/api/types';
import { Card, ErrorNote, Spinner, StatusBadge, Table } from './ui';

/**
 * Reassign a delivery run to a different partner — a core support action when a rider calls in
 * sick mid-morning and 40 customers are about to get no paper.
 *
 * The partner list is filtered to those who can actually take the run: VERIFIED, active, available,
 * covering the run's zone, and not the current assignee. Offering an ineligible partner just means
 * the backend rejects the reassignment after the agent has already told the customer it is sorted.
 */
export function RunReassign({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const [toPartnerId, setToPartnerId] = useState('');

  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<Run>(`/admin/delivery/runs/${runId}`),
    enabled: runId.length > 0,
  });

  const partners = useQuery({
    queryKey: ['delivery-partners'],
    queryFn: () => api.get<Partner[]>('/admin/delivery/partners'),
  });

  const reassign = useMutation({
    mutationFn: (partnerId: string) =>
      api.post<Run>(`/admin/delivery/runs/${runId}/reassign`, { toPartnerId: partnerId }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['run', runId], updated);
      setToPartnerId('');
    },
  });

  const eligible = (partners.data ?? []).filter(
    (p) =>
      p.kycStatus === 'VERIFIED' &&
      p.isActive &&
      p.isAvailable &&
      p.id !== run.data?.partnerId &&
      (run.data === undefined || p.zoneIds.includes(run.data.zoneId)),
  );

  return (
    <Card title="Run detail & reassignment">
      {run.isLoading && <Spinner />}
      {run.error !== null && <ErrorNote error={run.error} />}

      {run.data !== undefined && (
        <>
          <dl className="stat-grid">
            <div className="stat">
              <div className="stat__value mono">{run.data.runDate}</div>
              <div className="stat__label">Run date</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                <StatusBadge value={run.data.status} />
              </div>
              <div className="stat__label">Status</div>
            </div>
            <div className="stat">
              <div className="stat__value">{run.data.stops.length}</div>
              <div className="stat__label">Stops</div>
            </div>
          </dl>

          <div className="row" style={{ marginTop: '1rem' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="reassign-partner">Reassign to partner</label>
              <select
                id="reassign-partner"
                className="select"
                value={toPartnerId}
                onChange={(e) => setToPartnerId(e.target.value)}
                disabled={run.data.status === 'COMPLETED'}
              >
                <option value="">Select an eligible partner…</option>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? p.phone} · {p.vehicleType}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={toPartnerId === '' || reassign.isPending || run.data.status === 'COMPLETED'}
              onClick={() => reassign.mutate(toPartnerId)}
            >
              {reassign.isPending ? 'Reassigning…' : 'Reassign run'}
            </button>
          </div>

          {run.data.status === 'COMPLETED' && (
            <p className="muted">A completed run cannot be reassigned.</p>
          )}
          {reassign.error !== null && <ErrorNote error={reassign.error} />}
          {reassign.isSuccess && (
            <p className="muted" role="status">
              Run reassigned.
            </p>
          )}

          <div style={{ marginTop: '1.25rem' }}>
            <Table
              rowKey={(s) => s.id}
              rows={run.data.stops}
              columns={[
                { header: 'Seq', cell: (s) => s.sequence },
                { header: 'Status', cell: (s) => <StatusBadge value={s.status} /> },
                { header: 'Reason', cell: (s) => s.reason ?? '—' },
              ]}
            />
          </div>
        </>
      )}
    </Card>
  );
}
