'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Card, EmptyNote, ErrorNote, Spinner, StatusBadge, Table } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type { Batch, ChainOfCustody, Dispatch } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

export default function RecyclingPage() {
  const [batchId, setBatchId] = useState('');
  const [batchInput, setBatchInput] = useState('');

  const batches = useQuery({
    queryKey: ['recycling-batches'],
    queryFn: () => api.get<Batch[]>('/admin/recycling/batches'),
  });

  const flagged = useQuery({
    queryKey: ['recycling-flagged'],
    queryFn: () => api.get<Dispatch[]>('/admin/recycling/dispatches/flagged'),
  });

  const custody = useQuery({
    queryKey: ['chain-of-custody', batchId],
    queryFn: () => api.get<ChainOfCustody>(`/admin/recycling/batches/${batchId}/chain-of-custody`),
    enabled: batchId.length > 0,
  });

  const custodyNotFound =
    custody.error instanceof ApiError && custody.error.status === 404
      ? 'No batch with that id.'
      : null;

  return (
    <div>
      <div className="page-head">
        <h1>Recycling &amp; chain of custody</h1>
        <p className="muted">
          Collection batches, weighbridge discrepancies, and per-batch custody.
        </p>
      </div>

      <Card title="Flagged dispatches (weighbridge discrepancy)">
        {flagged.isLoading && <Spinner />}
        {flagged.error !== null && <ErrorNote error={flagged.error} />}
        {flagged.data !== undefined &&
          (flagged.data.length === 0 ? (
            <EmptyNote>No flagged dispatches. Weights are reconciling.</EmptyNote>
          ) : (
            <Table
              rowKey={(d) => d.id}
              rows={flagged.data}
              columns={[
                { header: 'Partner', cell: (d) => d.partnerName },
                { header: 'Status', cell: (d) => <StatusBadge value={d.status} /> },
                {
                  header: 'Discrepancy',
                  cell: (d) =>
                    d.discrepancyBps === null ? '—' : `${(d.discrepancyBps / 100).toFixed(2)}%`,
                },
                { header: 'Dispatched', cell: (d) => formatDateTime(d.dispatchedAt) },
              ]}
            />
          ))}
      </Card>

      <Card title="Collection batches">
        {batches.isLoading && <Spinner />}
        {batches.error !== null && <ErrorNote error={batches.error} />}
        {batches.data !== undefined &&
          (batches.data.length === 0 ? (
            <EmptyNote>No batches.</EmptyNote>
          ) : (
            <Table
              rowKey={(b) => b.id}
              rows={batches.data}
              columns={[
                { header: 'Reference', cell: (b) => <span className="mono">{b.reference}</span> },
                { header: 'Zone', cell: (b) => b.zoneName },
                { header: 'Paper', cell: (b) => b.paperType },
                { header: 'Status', cell: (b) => <StatusBadge value={b.status} /> },
                { header: 'Weight', cell: (b) => `${b.collectedWeightKg} kg` },
                { header: 'Items', cell: (b) => b.itemCount },
                {
                  header: '',
                  cell: (b) => (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setBatchInput(b.id);
                        setBatchId(b.id);
                      }}
                    >
                      Custody
                    </button>
                  ),
                },
              ]}
            />
          ))}
      </Card>

      <Card title="Chain of custody">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setBatchId(batchInput.trim());
          }}
        >
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="batch-id">Batch id</label>
            <input
              id="batch-id"
              className="input"
              placeholder="Paste a batch id (or click Custody above)"
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={batchInput.trim().length === 0}
          >
            Trace
          </button>
        </form>

        {batchId.length > 0 && custodyNotFound !== null && (
          <p className="error">{custodyNotFound}</p>
        )}
        {batchId.length > 0 && custodyNotFound === null && (
          <>
            {custody.isLoading && <Spinner />}
            {custody.data !== undefined && (
              <div style={{ marginTop: '1rem' }}>
                <div className="stat-grid">
                  <div className="stat">
                    <div className="stat__value">{custody.data.batch.collectedWeightKg} kg</div>
                    <div className="stat__label">Batch collected</div>
                  </div>
                  <div className="stat">
                    <div className="stat__value">{custody.data.items.length}</div>
                    <div className="stat__label">Pickups in batch</div>
                  </div>
                  <div className="stat">
                    <div className="stat__value">
                      <StatusBadge
                        value={custody.data.itemsReconcile ? 'RECONCILED' : 'MISMATCH'}
                      />
                    </div>
                    <div className="stat__label">Item weights vs batch</div>
                  </div>
                  <div className="stat">
                    <div className="stat__value">
                      {custody.data.dispatch === null ? (
                        '—'
                      ) : (
                        <StatusBadge value={custody.data.dispatch.status} />
                      )}
                    </div>
                    <div className="stat__label">Dispatch</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
