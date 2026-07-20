'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Card, EmptyNote, ErrorNote, Spinner, StatusBadge, Table } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { Seller } from '@/lib/api/types';

type SellerAction = 'VERIFY' | 'SUSPEND' | 'REINSTATE';

export default function MarketplacePage() {
  const queryClient = useQueryClient();

  const sellers = useQuery({
    queryKey: ['marketplace-sellers'],
    queryFn: () => api.get<Seller[]>('/admin/marketplace/sellers'),
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: SellerAction }) =>
      api.post<Seller>(`/admin/marketplace/sellers/${id}/transition`, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['marketplace-sellers'] }),
  });

  const actionsFor = (seller: Seller): SellerAction[] => {
    switch (seller.status) {
      case 'PENDING':
        return ['VERIFY', 'SUSPEND'];
      case 'VERIFIED':
        return ['SUSPEND'];
      case 'SUSPENDED':
        return ['REINSTATE'];
      default:
        return [];
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Marketplace</h1>
        <p className="muted">Seller onboarding and verification. Only verified sellers can sell.</p>
      </div>

      <Card title="Sellers">
        {sellers.isLoading && <Spinner />}
        {sellers.error !== null && <ErrorNote error={sellers.error} />}
        {transition.error !== null && <ErrorNote error={transition.error} />}
        {sellers.data !== undefined &&
          (sellers.data.length === 0 ? (
            <EmptyNote>No sellers onboarded yet.</EmptyNote>
          ) : (
            <Table
              rowKey={(s) => s.id}
              rows={sellers.data}
              columns={[
                { header: 'Name', cell: (s) => s.name },
                { header: 'Status', cell: (s) => <StatusBadge value={s.status} /> },
                { header: 'Contact', cell: (s) => `${s.contactName} · ${s.contactPhone}` },
                { header: 'Location', cell: (s) => `${s.city}, ${s.state}` },
                {
                  header: 'Actions',
                  cell: (s) => (
                    <div className="card__actions">
                      {actionsFor(s).map((action) => (
                        <button
                          key={action}
                          type="button"
                          className={`btn ${action === 'SUSPEND' ? 'btn--danger' : 'btn--ghost'}`}
                          disabled={transition.isPending}
                          onClick={() => transition.mutate({ id: s.id, action })}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          ))}
      </Card>
    </div>
  );
}
