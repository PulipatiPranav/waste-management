'use client';

import { useQuery } from '@tanstack/react-query';

import { ImpactMetricsGrid } from '@/components/impact-metrics';
import { Card, ErrorNote, Spinner, Table } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { ImpactReport } from '@/lib/api/impact';
import { formatDateTime } from '@/lib/format';

export default function SustainabilityPage() {
  const impact = useQuery({
    queryKey: ['impact', 'platform'],
    queryFn: () => api.get<ImpactReport>('/admin/impact/platform'),
  });

  return (
    <div>
      <div className="page-head">
        <h1>Sustainability</h1>
        <p className="muted">Platform-wide recycling impact, from confirmed-recycled weight.</p>
      </div>

      {impact.isLoading && <Spinner />}
      {impact.error !== null && <ErrorNote error={impact.error} />}

      {impact.data !== undefined && (
        <>
          <Card
            title="Lifetime"
            actions={
              <span className="muted mono">as of {formatDateTime(impact.data.computedAt)}</span>
            }
          >
            <ImpactMetricsGrid metrics={impact.data.lifetime} />
          </Card>

          <Card title="Monthly trend">
            {impact.data.monthly.length === 0 ? (
              <p className="muted">No monthly data yet.</p>
            ) : (
              <Table
                rowKey={(m) => m.yearMonth}
                rows={impact.data.monthly}
                columns={[
                  { header: 'Month', cell: (m) => m.yearMonth },
                  { header: 'Recycled (kg)', cell: (m) => m.recycledKg.toFixed(3) },
                  {
                    header: 'Est. CO₂e avoided (kg)',
                    cell: (m) => m.metrics.estimatedCo2eAvoidedKg.toFixed(3),
                  },
                ]}
              />
            )}
          </Card>

          <Card title="Methodology & honesty">
            <p className="muted">{impact.data.disclaimer}</p>
          </Card>
        </>
      )}
    </div>
  );
}
