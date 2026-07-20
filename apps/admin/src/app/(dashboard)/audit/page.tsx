'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Card, EmptyNote, ErrorNote, Spinner, StatusBadge, Table } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { AuditLog, AuditPage } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

interface Filters {
  actorUserId: string;
  targetId: string;
  action: string;
}

export default function AuditPage() {
  const [draft, setDraft] = useState<Filters>({ actorUserId: '', targetId: '', action: '' });
  const [applied, setApplied] = useState<Filters>({ actorUserId: '', targetId: '', action: '' });
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['audit', applied, cursor],
    queryFn: () => {
      const params = new URLSearchParams();
      if (applied.actorUserId) params.set('actorUserId', applied.actorUserId);
      if (applied.targetId) params.set('targetId', applied.targetId);
      if (applied.action) params.set('action', applied.action);
      if (cursor !== undefined) params.set('cursor', cursor);
      const qs = params.toString();
      return api.get<AuditPage>(`/admin/audit${qs.length > 0 ? `?${qs}` : ''}`);
    },
  });

  return (
    <div>
      <div className="page-head">
        <h1>Audit log</h1>
        <p className="muted">Every mutating staff action — who did what, to what, and when.</p>
      </div>

      <Card title="Filters">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setCursor(undefined);
            setApplied(draft);
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-actor">Actor user id</label>
            <input
              id="f-actor"
              className="input"
              value={draft.actorUserId}
              onChange={(e) => setDraft({ ...draft, actorUserId: e.target.value.trim() })}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-target">Target id</label>
            <input
              id="f-target"
              className="input"
              value={draft.targetId}
              onChange={(e) => setDraft({ ...draft, targetId: e.target.value.trim() })}
            />
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="f-action">Action</label>
            <input
              id="f-action"
              className="input"
              placeholder="POST /admin/wallet/adjustments"
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            />
          </div>
          <button type="submit" className="btn btn--primary">
            Apply
          </button>
        </form>
      </Card>

      <Card
        title="Trail"
        actions={
          query.data?.nextCursor != null ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
            >
              Next page →
            </button>
          ) : undefined
        }
      >
        {query.isLoading && <Spinner />}
        {query.error !== null && <ErrorNote error={query.error} />}
        {query.data !== undefined &&
          (query.data.rows.length === 0 ? (
            <EmptyNote>No audit entries match.</EmptyNote>
          ) : (
            <Table<AuditLog>
              rowKey={(r) => r.id}
              rows={query.data.rows}
              columns={[
                { header: 'When', cell: (r) => formatDateTime(r.createdAt) },
                {
                  header: 'Actor',
                  cell: (r) => (
                    <>
                      <div>{r.actorEmail ?? r.actorName ?? '—'}</div>
                      <div className="muted mono">{r.actorRole}</div>
                    </>
                  ),
                },
                { header: 'Action', cell: (r) => <span className="mono">{r.action}</span> },
                {
                  header: 'Target',
                  cell: (r) =>
                    r.targetId === null ? (
                      '—'
                    ) : (
                      <span className="mono">
                        {r.targetType}:{r.targetId.slice(0, 8)}
                      </span>
                    ),
                },
                { header: 'Status', cell: (r) => <StatusBadge value={String(r.statusCode)} /> },
              ]}
            />
          ))}
      </Card>
    </div>
  );
}
