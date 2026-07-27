# Load tests (k6)

Two [k6](https://k6.io) scripts targeting the highest-concurrency, highest-consistency-risk paths in
the system, as called out in the Phase 14 brief:

| Script                    | Endpoint                              | What it stresses                                                                                                                                      |
| ------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pickup-completion.k6.js` | `POST /delivery/pickups/:id/complete` | The one transaction that completes a pickup **and** credits the wallet. Proves throughput/latency and that an idempotent replay never double-credits. |
| `wallet-credit.k6.js`     | `POST /admin/wallet/adjustments`      | The append-only ledger write in isolation, in `spread` vs `contended` mode, to show where the per-wallet row lock becomes the wall.                   |

These are **not** part of `pnpm test` or CI's unit/e2e gates — they need a running API, Postgres and
Redis, and (for a meaningful number) production-like hardware. They are run on demand against a
staging environment. See [`docs/phase-14-production-readiness.md`](../../../docs/phase-14-production-readiness.md)
for the analysis of where each path breaks and why.

## Prerequisites

- `k6` installed (`brew install k6`, `apt install k6`, or the container image `grafana/k6`).
- The API running against a real Postgres + Redis (not the in-memory test harness).
- Tokens and seed data (below). Nothing here mints its own auth — pass real JWTs so the test
  exercises the real guard/throttler stack.

## Seeding

Both scripts consume pre-provisioned ids from `load/.seed/` (git-ignored):

- **`pickup-ids.txt`** — one `pickupId` per line, each an **ASSIGNED** pickup belonging to the
  partner whose token you pass. A pickup completes exactly once, so you need at least `vus ×
iterations` distinct ids; a completed id cannot be reused.
- **`user-ids.txt`** — one customer `userId` per line, each with a wallet. `spread` mode fans credits
  across all of them; `contended` mode hammers the first.

The repo's `pnpm db:seed` creates a baseline (a partner, customers, a rate card). Extending it to
emit a large pool of assigned pickups for a load run is a staging-only chore; the scripts read the
files rather than embedding seeding so the same script works against any environment's data.

## Running

```bash
# Wallet credit, fanned across wallets (scales with the pool):
k6 run -e BASE_URL=http://localhost:3000/api/v1 \
       -e ADMIN_TOKEN="$ADMIN_JWT" \
       -e USER_IDS_FILE=./load/.seed/user-ids.txt \
       -e MODE=spread \
       load/wallet-credit.k6.js

# Same endpoint, all credits to ONE wallet (exposes the row-lock ceiling):
k6 run ... -e MODE=contended load/wallet-credit.k6.js

# Pickup completion (also the wallet-credit path end to end):
k6 run -e BASE_URL=http://localhost:3000/api/v1 \
       -e PARTNER_TOKEN="$PARTNER_JWT" \
       -e PICKUP_IDS_FILE=./load/.seed/pickup-ids.txt \
       load/pickup-completion.k6.js
```

## Reading the result

k6 prints per-metric summaries and pass/fail against the `thresholds` in each script. The signals
that matter:

- `http_req_failed` — should stay `< 1%`. A climbing error rate under load is the breakpoint.
- `completion_latency_ms` / `credit_latency_ms` — p95/p99. On `wallet-credit` **contended** mode the
  p95 threshold is _expected_ to breach; that breach is the documented row-lock ceiling, not a
  regression.
- `idempotent_replay_ok` (pickup script) — must be `1.0`. Anything less means a replay produced a
  second credit, which is a correctness failure, not a performance one.
