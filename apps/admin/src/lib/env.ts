/**
 * Browser-safe configuration. Only `NEXT_PUBLIC_*` values live here — they are inlined into the
 * client bundle and are therefore PUBLIC. No secret ever belongs in this file.
 */

/** The versioned API base, e.g. `http://localhost:3000/api/v1`. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/**
 * The socket.io origin (scheme + host), derived by stripping the `/api/v1` path from the API
 * base — the Phase 3 delivery gateway is mounted on the server root, namespace `/delivery`, not
 * under the HTTP prefix.
 */
export const SOCKET_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return 'http://localhost:3000';
  }
})();

/**
 * Shown on the login page of the hosted public demo only. These are the seeded demo
 * account's credentials (apps/api/scripts/seed-demo.ts), not a secret.
 */
export const DEMO_CREDENTIALS =
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
    ? { email: 'demo@circularpaper.app', password: 'demo-password' }
    : null;
