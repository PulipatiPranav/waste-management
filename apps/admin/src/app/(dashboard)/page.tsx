'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { ImpactMetricsGrid } from '@/components/impact-metrics';
import { Card, ErrorNote, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { ImpactReport } from '@/lib/api/impact';
import { useAuth } from '@/lib/auth/auth-context';

export default function OverviewPage() {
  const { user } = useAuth();
  const impact = useQuery({
    queryKey: ['impact', 'platform'],
    queryFn: () => api.get<ImpactReport>('/admin/impact/platform'),
  });

  return (
    <div>
      <div className="page-head">
        <h1>Overview</h1>
        <p className="muted">
          Signed in as {user?.email ?? user?.name ?? 'staff'} ({user?.role}).
        </p>
      </div>

      <Card
        title="Platform impact (lifetime)"
        actions={<Link href="/sustainability">Details →</Link>}
      >
        {impact.isLoading && <Spinner />}
        {impact.error !== null && <ErrorNote error={impact.error} />}
        {impact.data !== undefined && <ImpactMetricsGrid metrics={impact.data.lifetime} />}
      </Card>

      <Card title="Jump to">
        <div className="stat-grid">
          <Link className="stat" href="/wallet">
            <div className="stat__value">Wallet oversight</div>
            <div className="stat__label">Look up a customer&rsquo;s ledger</div>
          </Link>
          <Link className="stat" href="/delivery">
            <div className="stat__value">Delivery runs</div>
            <div className="stat__label">Live status &amp; reassignment</div>
          </Link>
          <Link className="stat" href="/recycling">
            <div className="stat__value">Chain of custody</div>
            <div className="stat__label">Batches &amp; dispatches</div>
          </Link>
          <Link className="stat" href="/audit">
            <div className="stat__value">Audit log</div>
            <div className="stat__label">Who did what, when</div>
          </Link>
        </div>
      </Card>
    </div>
  );
}
