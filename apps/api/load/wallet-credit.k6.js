/**
 * k6 load test: wallet credit — the append-only ledger write under concurrency.
 *
 * `POST /admin/wallet/adjustments` (direction=CREDIT) is the direct wallet-credit endpoint: one
 * transaction takes `SELECT ... FOR UPDATE` on the wallet row, appends a CREDIT to the append-only
 * ledger, and moves the cached balance. It is the cleanest way to stress the ledger write in
 * isolation from the rest of the pickup flow.
 *
 * WHAT THIS MEASURES — and where it is EXPECTED to break
 *   The row lock SERIALISES writers on a single wallet: two credits to the SAME wallet cannot run
 *   concurrently, by design (that is what stops lost updates). So this test runs two scenarios and
 *   the contrast is the point:
 *     - `spread`: credits fan out across MANY wallets → scales with the DB connection pool; the
 *       breakpoint is pool/CPU, not the lock.
 *     - `contended`: every credit hits ONE wallet → throughput is bounded by lock hold time no
 *       matter how many VUs you add; p95 climbs as VUs queue on the row. This is not a bug, it is
 *       the consistency guarantee showing up as latency, and the test documents where that wall is.
 *
 * Each request carries a UNIQUE Idempotency-Key (a fresh credit every time), unlike the pickup test
 * which reuses keys to prove replay safety.
 *
 * RUN
 *   k6 run \
 *     -e BASE_URL=http://localhost:3000/api/v1 \
 *     -e ADMIN_TOKEN=<jwt for a FINANCE/admin staff user> \
 *     -e USER_IDS_FILE=./load/.seed/user-ids.txt \
 *     -e MODE=spread \            # or: contended
 *     load/wallet-credit.k6.js
 */
import { check, fail } from 'k6';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN;
const USER_IDS_FILE = __ENV.USER_IDS_FILE || './load/.seed/user-ids.txt';
const MODE = __ENV.MODE || 'spread';

const userIds = new SharedArray('userIds', () => {
  if (!ADMIN_TOKEN) fail('ADMIN_TOKEN is required');
  return open(USER_IDS_FILE)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
});

const creditLatency = new Trend('credit_latency_ms', true);

export const options = {
  scenarios: {
    credit: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 30 },
        { duration: '1m', target: 60 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // On `spread` this should hold; on `contended` expect p95 to breach — that breach IS the finding.
    credit_latency_ms: ['p(95)<500'],
  },
};

export default function () {
  // `contended` = always the first wallet; `spread` = round-robin across the pool.
  const userId = MODE === 'contended' ? userIds[0] : userIds[__ITER % userIds.length];

  const res = http.post(
    `${BASE_URL}/admin/wallet/adjustments`,
    JSON.stringify({
      userId,
      direction: 'CREDIT',
      amountPaise: '100',
      note: 'k6 load test credit',
    }),
    {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': uuidv4(), // a NEW credit each time
      },
    },
  );

  creditLatency.add(res.timings.duration);
  check(res, { 'credit 200/201': (r) => r.status === 200 || r.status === 201 });
}
