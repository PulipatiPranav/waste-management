'use client';

import { WalletOversight } from '@/components/wallet-oversight';

export default function WalletPage() {
  return (
    <div>
      <div className="page-head">
        <h1>Wallet oversight</h1>
        <p className="muted">
          Answer &ldquo;why does this wallet say ₹X?&rdquo; — the cached balance, the ledger that
          produced it, and whether the two reconcile.
        </p>
      </div>
      <WalletOversight />
    </div>
  );
}
