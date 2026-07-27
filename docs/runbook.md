# Runbook — Circular Paper Economy

Operational guide for the API, worker, admin and mobile release pipeline. For the observability
and security posture behind this, see [`phase-14-production-readiness.md`](phase-14-production-readiness.md);
for the manifests, [`infra/k8s/README.md`](../infra/k8s/README.md).

> **On call:** primary → `@oncall-platform` (PagerDuty _CPE-Platform_). Money-path incidents (wallet,
> pickup credit, reconciliation) also notify `@finance-eng`. Replace these with your real rotation.

---

## 1. Deploy

Everything ships through GitHub Actions — never `kubectl apply` by hand except in a break-glass
incident (§5).

### Backend (API + worker + admin)

- **Trigger:** merge to `main` → [`deploy.yml`](../.github/workflows/deploy.yml) runs automatically.
- **Flow:** build & push immutable images (tagged `sha-<short>`) → **deploy to staging** →
  **pause at the `production` approval gate** → deploy to production after a human approves.
- **The migration step is separate and runs first.** Each environment runs the `cpe-migrate` Job
  (`prisma migrate deploy`) and **waits for it to succeed before rolling out the app**. A failed
  migration aborts the deploy before any new code serves traffic. `migrate deploy` only applies
  already-committed, reviewed migration files — it never generates or resets.
- **Approve production:** the run stops at _Deploy → production_. A reviewer approves it in the
  GitHub UI (Actions → the run → _Review deployments_). Configure required reviewers on the
  `production` Environment in repo settings.
- **Redeploy / deploy a specific commit:** run `deploy.yml` via _workflow_dispatch_ with the `ref`
  input (a SHA or tag).

### Mobile (Android + iOS)

- **Trigger:** push a tag `mobile-v<version>` → [`mobile-release.yml`](../.github/workflows/mobile-release.yml)
  builds a signed AAB and IPA automatically.
- **Promotion is manual:** the `promote-android` / `promote-ios` jobs pause at the `play-internal` /
  `appstore-internal` approval gates. After approval they upload to the **internal testing track**
  (Play) / **TestFlight** — as a draft, never straight to production. Promote to production from the
  Play Console / App Store Connect by hand.

---

## 2. Roll back

**Backend — fastest (no rebuild):**

```bash
# Roll a Deployment back to its previous ReplicaSet:
kubectl -n cpe rollout undo deployment/cpe-api
kubectl -n cpe rollout undo deployment/cpe-worker
kubectl -n cpe rollout status deployment/cpe-api
```

**Backend — redeploy a known-good image:** run `deploy.yml` (workflow_dispatch) with `ref` set to the
last good tag/SHA. This re-runs migrations first — safe, because `migrate deploy` is a no-op when
there's nothing new to apply.

**⚠️ Migrations do not roll back automatically.** A rollback reverts _code_, not _schema_. This is why
migrations must be **backward-compatible** (expand/contract: add columns nullable, deploy code that
writes both, backfill, only later drop) — so the previous image keeps working against the new schema.
If a migration is genuinely incompatible, rolling back code alone is not safe; page `@finance-eng`
before touching a money-path table and restore from the DB snapshot taken pre-migration.

**Mobile:** you cannot "roll back" an installed app. Halt the rollout on the store track and promote
the previous build. Because the app is **offline-first** (Phase 13) and the API is backward-compatible,
a bad app build degrades gracefully rather than losing field data.

---

## 3. Check system health

**Liveness/readiness (in-cluster or via port-forward):**

```bash
kubectl -n cpe get pods
kubectl -n cpe port-forward deploy/cpe-api 3000:3000
curl localhost:3000/health/live     # process up
curl localhost:3000/health/ready    # Postgres + Redis reachable (503 if not)
```

**Metrics (Prometheus):** `GET /metrics` — in-cluster only, never public. Watch:
`http_request_duration_seconds` (latency/error rate per handler), `pickup_completed_total`,
`wallet_credit_total`, event-loop lag, heap. Grafana dashboards scrape these.

**Traces (if OTEL enabled):** find the request by its `correlationId` and follow the span tree
(HTTP → Prisma queries → any BullMQ job).

**Logs:** structured JSON. Filter by correlation id end-to-end:

```bash
kubectl -n cpe logs deploy/cpe-api | jq 'select(.correlationId=="<id>")'
```

The mobile app sends `x-correlation-id`; a support ticket that quotes it resolves to the exact
request chain across app → API → worker.

**Queues (BullMQ):** check depth/failed counts by connecting to Redis, or add Bull Board. A growing
`failed` set on a queue is the signal in §4.

---

## 4. The wallet-credit job failed at 2am — now what

**What this means.** Two money jobs run overnight on the **worker** Deployment:
`wallet-maintenance` (02:00 — replays every wallet's ledger and **alerts on any mismatch**) and,
during the day, pickup completion appends the cashback CREDIT inside the pickup transaction. A page
here is almost always the **02:00 reconciliation** finding a discrepancy, or a worker crash-looping.

**Reassure yourself of the invariant first.** The ledger is **append-only and DB-trigger-enforced**,
every credit is **idempotent** (idempotency key + `SELECT … FOR UPDATE` + a unique pickup→credit
guard), and jobs **retry with backoff and dead-letter rather than drop**. So a failed job has almost
certainly **not** lost or double-paid money — it has either not yet applied a credit, or reconciliation
is flagging a genuine mismatch to a human on purpose. Do not manually "fix" a balance by hand.

**Triage:**

1. **Is the worker up?** `kubectl -n cpe get pods -l app.kubernetes.io/name=cpe-worker` and
   `kubectl -n cpe logs deploy/cpe-worker --since=1h | jq 'select(.level>=50)'` (errors). A
   crash-loop → check `/health/ready` (Postgres/Redis reachable?) and recent deploys.
2. **Reconciliation mismatch?** The job logs the wallet id and the cached-vs-replayed balances. Pull
   that wallet's ledger and re-run the reconcile for it:
   `GET /api/v1/admin/wallet/users/<userId>/reconcile` (as staff). The ledger sum is the source of
   truth; the cached balance is what may be stale.
3. **Stuck/failed queue jobs?** Inspect the queue's `failed` set. A job dead-letters after its
   retries; it is preserved, not lost. Once the root cause (a DB blip, a bad deploy) is fixed,
   re-enqueue it.
4. **Correlate.** Every job runs in a span/log line; use the pickup id or user id to trace the exact
   completion that triggered the credit.

**Fixing a genuine discrepancy** is done through the **audited adjustment endpoint**
(`POST /api/v1/admin/wallet/adjustments`, idempotent, attributed to the actor with a note) — never a
raw SQL `UPDATE`. That is the only sanctioned way to move a balance, and it writes a ledger row an
auditor can read.

**Escalate to `@finance-eng`** if: reconciliation reports a mismatch it cannot self-explain, the
`failed` set is growing faster than you can drain it, or you are about to touch a wallet by hand.

---

## 5. Break-glass (manual cluster access)

Only when CI is unavailable and something is on fire.

```bash
# Render + apply an environment by hand (image tags come from the overlay):
kubectl apply -k infra/k8s/overlays/production
# Scale the worker up to burn down a backlog:
kubectl -n cpe scale deployment/cpe-worker --replicas=4
# Pull a bad pod's recent logs:
kubectl -n cpe logs <pod> --previous
```

Record any manual change in the incident channel and reconcile it back into git immediately — the
next CI deploy will otherwise overwrite it.

---

## 6. Secrets

- Never commit a secret — not in code, not in `.env` (only `.env.example`), not base64 in a k8s
  Secret manifest. `api-secret.example.yaml` documents the _keys_ only.
- Production secrets come from the **External Secrets Operator** reading your cloud secret manager
  (`infra/k8s/base/external-secrets.example.yaml`). Rotating a value there re-syncs into the cluster.
- The **env schema fails fast**: the API refuses to boot in production without a real
  `JWT_ACCESS_SECRET`, a non-default `PAYMENT_WEBHOOK_SECRET`, and real (non-stub) providers.
- CI/CD secrets live in GitHub: `KUBE_CONFIG_STAGING/PRODUCTION`, the mobile signing set, and the
  store credentials. See the setup roadmap for the full list.

---

## 7. Known operational follow-ups

- **Worker autoscaling is CPU-based**; queue-depth scaling (KEDA Redis scaler) is the real fix for
  a backlog that isn't CPU-bound.
- **Real SMS + S3-compatible storage providers** must be implemented before the API boots in
  `NODE_ENV=production` (the schema ships only dev stubs and refuses them in prod).
- **Load-test numbers** (`apps/api/load/`) still need a staging run to set HPA thresholds from data.
- **Managed Postgres + Redis** (with automated backups/PITR) are strongly preferred over
  self-hosting the stateful pieces.
