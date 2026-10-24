'use client';

import { WalletOversight } from '@/components/wallet-oversight';
import { DEMO_CREDENTIALS } from '@/lib/env';

export default function WalletPage() {
  return (
    <div>
      <div className="page-head">
        <h1>Wallet oversight</h1>
        <p className="muted">
          Answer &ldquo;why does this wallet say ₹X?&rdquo; — the cached balance, the ledger that
          produced it, and whether the two reconcile.
        </p>
        {DEMO_CREDENTIALS !== null && (
          <p className="muted">
            Demo: try <code>9000000104</code> (a customer with a pending withdrawal) or{' '}
            <code>9000000103</code>.
          </p>
        )}
      </div>
      <WalletOversight />
    </div>
  );
}
