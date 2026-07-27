/**
 * k6 load test: pickup completion — the highest-consistency-risk write in the product.
 *
 * `POST /delivery/pickups/:id/complete` runs ONE transaction that completes the pickup, writes its
 * items, appends exactly one CREDIT to the append-only wallet ledger, and moves the balance. It is
 * both the "pickup-completion" and the "wallet-credit" path the brief names — the credit is a side
 * effect of completion, there is no standalone "credit the wallet" endpoint for customers.
 *
 * WHAT THIS MEASURES
 *   - Throughput and latency (p95/p99) of the completion transaction under concurrency.
 *   - Correctness under load: completing the SAME pickup twice must not double-credit. Each VU
 *     iteration completes a DISTINCT pickup once, and also fires a second request for the SAME
 *     pickup with the SAME Idempotency-Key to prove the replay returns the original result (not a
 *     second credit).
 *
 * SEEDING (required — see load/README.md)
 *   A pickup can be completed exactly once, so the test needs a pool of DISTINCT, already-ASSIGNED
 *   pickups. Provide them as a newline-delimited file of `pickupId` values via PICKUP_IDS_FILE,
 *   produced by the companion seeding step. One id is consumed per iteration; size the pool to
 *   `vus * iterations`.
 *
 * RUN
 *   k6 run \
 *     -e BASE_URL=http://localhost:3000/api/v1 \
 *     -e PARTNER_TOKEN=<jwt for the assigned partner> \
 *     -e PICKUP_IDS_FILE=./load/.seed/pickup-ids.txt \
 *     load/pickup-completion.k6.js
 */
import { check, fail } from 'k6';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const PARTNER_TOKEN = __ENV.PARTNER_TOKEN;
const PICKUP_IDS_FILE = __ENV.PICKUP_IDS_FILE || './load/.seed/pickup-ids.txt';

// Load the seeded pickup ids once, shared across VUs (not copied per-VU).
const pickupIds = new SharedArray('pickupIds', () => {
  if (!PARTNER_TOKEN) fail('PARTNER_TOKEN is required');
  return open(PICKUP_IDS_FILE)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
});

const completionLatency = new Trend('completion_latency_ms', true);
const doubleCreditGuard = new Rate('idempotent_replay_ok');
const completed = new Counter('pickups_completed');

export const options = {
  scenarios: {
    // Ramp concurrency so the breakpoint (where p95 latency or error rate climbs) is visible on the
    // curve rather than as a single pass/fail.
    ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 25 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // The money path must stay correct AND responsive. A failed threshold is the "where it breaks"
    // signal the brief asks for.
    http_req_failed: ['rate<0.01'],
    completion_latency_ms: ['p(95)<800', 'p(99)<2000'],
    idempotent_replay_ok: ['rate==1.0'], // a replay must NEVER produce a second credit
  },
};

// Each iteration consumes a distinct pickup id by index; the pool must be >= total iterations.
let cursor = 0;

export default function () {
  const index = (__VU - 1) * 100000 + cursor++;
  if (index >= pickupIds.length) return; // pool exhausted — do not reuse a completed pickup
  const pickupId = pickupIds[index];

  const idempotencyKey = `k6-${pickupId}`;
  const headers = {
    Authorization: `Bearer ${PARTNER_TOKEN}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  const body = JSON.stringify({
    weights: [
      { paperType: 'NEWSPAPER', weightGrams: 4200 },
      { paperType: 'MIXED', weightGrams: 1500 },
    ],
  });

  const url = `${BASE_URL}/delivery/pickups/${pickupId}/complete`;

  const first = http.post(url, body, { headers });
  completionLatency.add(first.timings.duration);
  const firstOk = check(first, { 'completion 200': (r) => r.status === 200 });
  if (firstOk) completed.add(1);

  // Replay with the SAME key: must return the SAME result and must NOT credit again.
  const replay = http.post(url, body, { headers });
  const balancesMatch =
    first.status === 200 &&
    replay.status === 200 &&
    first.json('walletBalancePaise') === replay.json('walletBalancePaise');
  doubleCreditGuard.add(balancesMatch);
  check(replay, { 'replay is idempotent (no second credit)': () => balancesMatch });
}
