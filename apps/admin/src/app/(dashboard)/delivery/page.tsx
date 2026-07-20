'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { RunReassign } from '@/components/run-reassign';
import { Card, EmptyNote, ErrorNote, Spinner, StatusBadge, Table } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { CompletionStats } from '@/lib/api/types';
import { useDeliveryFeed } from '@/lib/realtime/use-delivery-feed';
import { formatDateTime } from '@/lib/format';

export default function DeliveryPage() {
  const feed = useDeliveryFeed();
  const [runId, setRunId] = useState('');
  const [runInput, setRunInput] = useState('');

  const completion = useQuery({
    queryKey: ['delivery-completion'],
    queryFn: () => api.get<CompletionStats[]>('/admin/delivery/completion'),
  });

  return (
    <div>
      <div className="page-head">
        <h1>Delivery runs</h1>
        <p className="muted">Today&rsquo;s completion, a live status feed, and run reassignment.</p>
      </div>

      <Card
        title="Live feed"
        actions={
          <span className="muted">
            <span className={`live-dot live-dot--${feed.connected ? 'on' : 'off'}`} />
            {feed.connected ? 'Connected' : 'Disconnected'}
          </span>
        }
      >
        {feed.events.length === 0 ? (
          <EmptyNote>
            Waiting for stop updates… (events appear here as partners mark stops in the field)
          </EmptyNote>
        ) : (
          <Table
            rowKey={(e) => `${e.stopId}-${e.at}`}
            rows={feed.events}
            columns={[
              { header: 'At', cell: (e) => formatDateTime(e.at) },
              { header: 'Stop', cell: (e) => <StatusBadge value={e.status} /> },
              { header: 'Reason', cell: (e) => e.reason ?? '—' },
              {
                header: 'Run',
                cell: (e) => (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setRunInput(e.runId);
                      setRunId(e.runId);
                    }}
                  >
                    Open
                  </button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Completion by run (today)">
        {completion.isLoading && <Spinner />}
        {completion.error !== null && <ErrorNote error={completion.error} />}
        {completion.data !== undefined &&
          (completion.data.length === 0 ? (
            <EmptyNote>No runs today.</EmptyNote>
          ) : (
            <Table
              rowKey={(s) => `${s.zoneId}-${s.partnerId}`}
              rows={completion.data}
              columns={[
                { header: 'Zone', cell: (s) => s.zoneName },
                { header: 'Partner', cell: (s) => s.partnerName ?? '—' },
                { header: 'Delivered', cell: (s) => `${s.delivered}/${s.total}` },
                { header: 'Failed', cell: (s) => s.failed },
                { header: 'Pending', cell: (s) => s.pending },
                {
                  header: 'Rate',
                  cell: (s) =>
                    s.completionRate === null ? '—' : `${Math.round(s.completionRate * 100)}%`,
                },
              ]}
            />
          ))}
      </Card>

      <Card title="Reassign a run">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setRunId(runInput.trim());
          }}
        >
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="run-id">Run id</label>
            <input
              id="run-id"
              className="input"
              placeholder="Paste a run id (or click Open on a live event)"
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={runInput.trim().length === 0}
          >
            Load run
          </button>
        </form>
      </Card>

      {runId.length > 0 && <RunReassign runId={runId} />}
    </div>
  );
}
