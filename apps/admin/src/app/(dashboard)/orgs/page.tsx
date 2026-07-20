'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ImpactMetricsGrid } from '@/components/impact-metrics';
import { Card, ErrorNote, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type { ImpactReport } from '@/lib/api/impact';

type OrgKind = 'apartments' | 'businesses';

/**
 * Org account oversight for staff. Member and contract management is done by each org's own admin
 * (tenant-scoped, and staff are not members) — what staff CAN see cross-tenant is an org's
 * aggregate recycling impact, via the admin impact endpoints. A lookup by org id, kept honest
 * about that boundary.
 */
export default function OrgsPage() {
  const [kind, setKind] = useState<OrgKind>('apartments');
  const [orgInput, setOrgInput] = useState('');
  const [orgId, setOrgId] = useState('');

  const impact = useQuery({
    queryKey: ['org-impact', kind, orgId],
    queryFn: () => api.get<ImpactReport>(`/admin/impact/${kind}/${orgId}`),
    enabled: orgId.length > 0,
  });

  const notFound =
    impact.error instanceof ApiError && impact.error.status === 404
      ? 'No org with that id, or no impact recorded yet.'
      : null;

  return (
    <div>
      <div className="page-head">
        <h1>Org accounts</h1>
        <p className="muted">
          Look up an apartment or business by id to see its aggregate recycling impact.
        </p>
      </div>

      <Card title="Look up an org">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setOrgId(orgInput.trim());
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="org-kind">Type</label>
            <select
              id="org-kind"
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as OrgKind)}
            >
              <option value="apartments">Apartment</option>
              <option value="businesses">Business</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="org-id">Org id</label>
            <input
              id="org-id"
              className="input"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={orgInput}
              onChange={(e) => setOrgInput(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={orgInput.trim().length === 0}
          >
            Look up
          </button>
        </form>
      </Card>

      {orgId.length > 0 && notFound !== null && <p className="error">{notFound}</p>}
      {orgId.length > 0 && notFound === null && (
        <Card title="Aggregate impact (lifetime)">
          {impact.isLoading && <Spinner />}
          {impact.error !== null && notFound === null && <ErrorNote error={impact.error} />}
          {impact.data !== undefined && <ImpactMetricsGrid metrics={impact.data.lifetime} />}
        </Card>
      )}
    </div>
  );
}
