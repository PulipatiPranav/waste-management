import type { HealthCheckResponse } from '@cpe/shared-types';

/**
 * Placeholder landing page. Phase 9 replaces this with the real ops console
 * (delivery runs, wallet ledger oversight, chain-of-custody, audit log).
 *
 * It imports a type from `@cpe/shared-types` on purpose: it keeps the api -> admin
 * type path exercised by CI from day one, so the wiring is known to work before
 * anything depends on it.
 */
const PLACEHOLDER_STATUS: HealthCheckResponse['status'] = 'ok';

export default function HomePage() {
  return (
    <main className="shell">
      <h1>CPE Ops Console</h1>
      <p className="muted">
        Phase 0 scaffolding. Status contract resolves to <code>{PLACEHOLDER_STATUS}</code> via{' '}
        <code>@cpe/shared-types</code>.
      </p>
      <p className="muted">
        The API is expected at <code>{process.env.NEXT_PUBLIC_API_BASE_URL ?? 'unset'}</code>.
      </p>
    </main>
  );
}
