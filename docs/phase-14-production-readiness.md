# Phase 14 — Production readiness: observability & security findings

**Scope:** observability (tracing, metrics, structured logs, error reporting) and a security pass
over the API built in Phases 1–10, plus load tests of the two highest-risk money paths. This is the
"before infra/deployment" phase — Kubernetes, secrets management and CI/CD to a cluster are Phase 15.

**Status legend:** ✅ done & verifiable here · 🟡 wired, needs the live stack to exercise · ⚠️ known
risk requiring a decision.

---

## 1. Observability

### 1.1 Structured logging ✅

- Replaced Nest's text logger with **pino** (`nestjs-pino`), so every line is JSON with a level, a
  timestamp, and a `reqId`/`correlationId`.
- **Correlation IDs thread end to end.** The mobile app already stamps `x-correlation-id` on every
  request (`CorrelationIdInterceptor`); the API reuses it as pino's `reqId` and echoes it on the
  response and in `ApiErrorResponse.correlationId`. A support ticket ("my cashback didn't arrive")
  resolves to the exact request chain across app → API → logs.
- `CorrelationIdMiddleware` and pino's `genReqId` are **idempotent with each other** — whichever
  runs first wins, the other reuses the value — so the id is stable regardless of middleware order.
- **Secret redaction** (`REDACT_PATHS`): the `authorization`/`cookie`/`x-api-key` headers and a
  defensive sweep of `*.password`/`*.otp`/`*.token`/`*.secret` are `[redacted]` before a line is
  written. pino-http does not log request bodies, so the OTP code and JWTs in payloads never reach
  the log stream in the first place.

### 1.2 Tracing (OpenTelemetry) 🟡

- `src/instrumentation.ts` is imported **first** in `main.ts` (before `AppModule`) so the SDK patches
  libraries before they load. Instrumented: **HTTP** (incoming/outgoing), **Express**, **ioredis**
  (so all BullMQ↔Redis traffic is traced), and **Prisma** (`@prisma/instrumentation` → a span per DB
  query — the "DB queries" leg).
- **BullMQ job execution** is traced via `TracedWorkerHost`: all six workers extend it and implement
  `processJob`, and each job runs inside a `job <queue> <name>` span with error status on failure —
  one tracing point rather than six copies.
- Spans export over **OTLP/HTTP** to the collector at `OTEL_EXPORTER_OTLP_ENDPOINT`. Health probes
  and `/metrics` are excluded so high-frequency noise doesn't bury real traces.
- **Off by default.** `OTEL_ENABLED=false` in dev/test (no collector needed); the deploy sets it
  true and the env schema then _requires_ an endpoint. Verifiable in the live stack (Phase 15).

### 1.3 Metrics (Prometheus) ✅

- `GET /metrics` (Prometheus exposition), pinned at a stable unprefixed, version-neutral path like
  the health probes, `@Public` + `@SkipThrottle`, and switchable off with `METRICS_ENABLED=false`.
- Default Node metrics (event-loop lag, heap, GC, handles) + an `http_request_duration_seconds`
  histogram labelled by `method`/`route`/`status` (route = handler identity, **not** the raw URL, so
  ids don't explode Prometheus cardinality) + business counters `wallet_credit_total` and
  `pickup_completed_total`. The histogram is exactly the latency/throughput/error signal you watch
  during a load test.
- **Not on the public ingress.** In Phase 15 `/metrics` is reachable only inside the cluster (a
  ServiceMonitor / separate port), never from the internet.

### 1.4 Error reporting (Sentry) 🟡

- **API:** `@sentry/node`, initialised in `instrumentation.ts`, gated on `SENTRY_DSN`. `beforeSend`
  strips the same sensitive headers as the log redaction.
- **Admin (Next.js):** `@sentry/nextjs` via `instrumentation.ts` (server) and
  `instrumentation-client.ts` (browser), `withSentryConfig` in `next.config.ts`. **Session Replay is
  off** — an ops dashboard renders customer PII and replays would ship it to a third party.
- **Mobile (Flutter):** `sentry_flutter` wraps `main()` when a DSN is passed via `--dart-define`. No
  screenshots, no default PII — a crash report must never leak a customer's data.
- All three are **inert without a DSN**, so dev and tests send nothing. Verifiable end to end once
  DSNs are provisioned (Phase 15).

---

## 2. Security pass — OWASP API Security Top 10 (2023)

Reviewed against the endpoints built in Phases 1–10. The codebase entered this phase in strong shape
(ownership-from-token throughout, a global auth guard, Redis-backed throttling, an append-only ledger
with row locks). One real code fix came out of it; the rest is verification.

| #     | Risk                                                    | Verdict   | Evidence / notes                                                                                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API1  | **Broken Object Level Auth (BOLA/IDOR)**                | ✅ Secure | Owner is always derived from the JWT, never the request. Pickups (`loadOwned(userId,id)`), wallet withdrawals (`withdrawal.userId !== userId → Forbidden`), marketplace orders (`getMyOrder` → **404** on someone else's id, so existence isn't confirmed to a stranger), pickup scan (`assignedPartnerId` must match). See §2.1. |
| API2  | **Broken Authentication**                               | ✅ Secure | OTP + JWT; short access-token TTL; refresh tokens rotate; per-phone **and** per-IP OTP budgets (Redis); Argon2 for staff secrets; no fallback JWT secret (boot refuses without one).                                                                                                                                              |
| API3  | **Broken Object Property Level Auth / mass assignment** | ✅ Secure | Global `ValidationPipe` with `whitelist: true` **and** `forbidNonWhitelisted: true` — unknown properties are rejected, not silently bound. Responses go through explicit DTO mappers, not raw entities.                                                                                                                           |
| API4  | **Unrestricted Resource Consumption**                   | ✅ Fixed  | Global Redis throttler (120/min/IP) + tighter per-endpoint auth limits. **Upload endpoint hardened this phase** — see §2.2.                                                                                                                                                                                                       |
| API5  | **Broken Function Level Auth**                          | ✅ Secure | Global `JwtAuthGuard` (opt out only via greppable `@Public()`) + `RolesGuard`; admin/partner controllers are `@Roles(...)` at class level.                                                                                                                                                                                        |
| API6  | **Unrestricted access to sensitive business flows**     | ✅ Secure | The money flow (pickup completion, withdrawals, adjustments) requires an `Idempotency-Key` and is transactional; withdrawals go through an approval workflow, not auto-payout.                                                                                                                                                    |
| API7  | **SSRF**                                                | ✅ N/A    | The API makes no outbound request to a user-supplied URL. Signed proof-of-delivery URLs are built from a server-configured `PUBLIC_BASE_URL`, not client input.                                                                                                                                                                   |
| API8  | **Security Misconfiguration**                           | ✅ Secure | `helmet()` on; CORS is an **allowlist** from `CORS_ORIGINS` (never `*`, with `credentials: true`); `trust proxy` = 1 (not `true`, which would let a client spoof its IP and mint rate-limit buckets); Swagger, console-SMS, local-storage and fake gateways are **refused in production** by the env schema.                      |
| API9  | **Improper Inventory Management**                       | ✅ Secure | Single versioned prefix (`/api/v1`); health + metrics pinned at fixed paths; OpenAPI spec is the generated source of truth; Swagger UI is off in prod.                                                                                                                                                                            |
| API10 | **Unsafe Consumption of APIs**                          | ✅ Secure | The one third-party integration (payment gateway) verifies **HMAC-SHA256 over the raw body** against `PAYMENT_WEBHOOK_SECRET`, which has no production default.                                                                                                                                                                   |

Plus the specific checks the brief named:

- **SQL injection:** every raw query (`wallet-ledger.writer`, `prisma-impact`, `prisma-marketplace`,
  `prisma.service`) uses Prisma's **tagged-template** `$queryRaw`/`$executeRaw`, which parameterises
  `${…}` as bind variables. **No** `$queryRawUnsafe`/`$executeRawUnsafe` anywhere. Not injectable.
- **CORS:** allowlist from env, trimmed, empty entries filtered; not a wildcard.
- **Secrets in logs:** no `console.*` in `src`. OTP logs use `phone.masked`, never the code. Header
  redaction added (§1.1). The console SMS provider (which prints codes) is refused in production.

### 2.1 BOLA spot-checks (verified in code)

```
pickups:      get(userId,id)      -> loadOwned(userId,id)          // 404/forbidden for non-owner
wallet:       getWithdrawal       -> userId !== owner -> Forbidden
marketplace:  getMyOrder(userId)  -> order.userId !== userId -> NotFound(404)  // no existence leak
delivery:     scan(userId,token)  -> pickup.assignedPartnerId !== partner.id -> NotFound
```

### 2.2 The one real fix — file upload hardening (API4/API8)

`POST /delivery/stops/:id/photo` previously (a) buffered the **entire** upload into memory via
`FileInterceptor('photo')` with no `limits`, and only checked size _after_, and (b) validated
`file.mimetype` — which is the **client-supplied** multipart `Content-Type`, a claim, not a fact.

Fixed:

1. **Stream-level ceiling** — `FileInterceptor('photo', { limits: { fileSize: 12 MB, files: 1 } })`
   aborts an oversized upload mid-stream instead of reading gigabytes into memory. The exact
   per-photo policy (`DELIVERY_PHOTO_MAX_BYTES`) is still enforced after.
2. **Magic-byte sniffing** — `sniffImage()` checks the real first bytes (JPEG `FF D8 FF`, PNG
   `89 50 4E 47 …`); anything that isn't truly a JPEG/PNG is rejected, and we **store the sniffed
   type**, so a spoofed header can neither get a non-image stored nor mislabel what we persist.

Covered by unit tests (`image-signature.spec.ts`).

---

## 3. Load tests (k6)

Scripts and run instructions: [`apps/api/load/`](../apps/api/load/README.md). They target the two
highest-consistency-risk paths. They are **not** part of CI (they need a live API + Postgres + Redis
and production-like hardware); they run on demand against staging. Below is the analysis of where
each path breaks and **why**, from the architecture — to be confirmed with numbers on staging
hardware in Phase 15.

### 3.1 Pickup completion (`POST /delivery/pickups/:id/complete`)

One transaction: complete pickup → write items → append **one** CREDIT to the ledger → move balance.
Each completion touches a **different** customer wallet, so completions rarely contend on the same
row — throughput scales with the **Postgres connection pool and CPU**, not a shared lock.

- **Expected breakpoint:** connection-pool saturation. Beyond `pool_size` concurrent transactions,
  requests queue for a connection and p95 climbs; the fix is pool sizing + read/write splitting, a
  Phase-15 infra tuning, not a code change.
- **Correctness under load** is the sharper question, and the script asserts it: a replay with the
  same `Idempotency-Key` must return the **original** balance (`idempotent_replay_ok == 1.0`). The
  three independent guards (idempotency interceptor, `SELECT … FOR UPDATE`, unique pickup→credit)
  mean concurrency can add latency but **cannot** double-credit.

### 3.2 Wallet credit (`POST /admin/wallet/adjustments`)

Deliberately run in two modes to expose the shape of the guarantee:

- **`spread`** (credits fan across many wallets): like §3.1, scales with the pool. p95 threshold
  should hold.
- **`contended`** (every credit hits **one** wallet): `SELECT … FOR UPDATE` serialises writers on
  that row, so **throughput is bounded by lock-hold time regardless of VU count** and p95 rises as
  VUs queue. **This breach is expected and is the point** — it's the lost-update guarantee showing up
  as latency, not a regression. The only "fix" would weaken correctness, so we don't; single-wallet
  write rate is simply a documented ceiling (not a real workload — no one credits one wallet in a
  tight loop).

---

## 4. Known risks requiring a decision

| #   | Risk                                                                                                                                               | Why it's open                                                                                                       | Needs                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **PPI / RBI compliance (from Phase 4).** The wallet holds real customer money but is **not** a licensed prepaid instrument.                        | Legal/regulatory, not code. Already flagged in the README's regulatory note.                                        | A product/legal decision before piloting with real money: partner with a licensed PPI issuer, or restrict cash-out.                      |
| R2  | **Payment automation (from Phase 8).** Withdrawals are **manually approved**, not auto-paid; the gateway is verified but no automated payout runs. | Intentional for the pilot; auto-payout needs the licensed rails from R1.                                            | Decision on a payout provider + reconciliation SLA.                                                                                      |
| R3  | **`/metrics` exposure.** Public + unauthenticated by design (Prometheus can't present a token).                                                    | Safe only if network-isolated.                                                                                      | Phase-15 infra must keep `/metrics` **off the public ingress** (internal port / ServiceMonitor). Enforced by deployment, not code.       |
| R4  | **Observability is inert until configured.** OTel/Sentry are off without a collector/DSN.                                                          | Correct default (dev/test send nothing), but production must not ship blind.                                        | Phase-15 deploy must set `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and the three `SENTRY_DSN`s, and run the collector + Prometheus. |
| R5  | **Load-test numbers are pending.** Breakpoints in §3 are analytical.                                                                               | No production-like hardware or seeded staging data in this phase.                                                   | A staging run in Phase 15 to attach real p95/p99 and pool-size guidance.                                                                 |
| R6  | **Upload malware scanning.** We validate type/size/magic bytes but do **not** AV-scan proof photos.                                                | Low risk (images are never executed, served with `Content-Disposition`/no-sniff from object storage), but not zero. | Decision on whether doorway photos warrant an AV pipeline; likely deferred.                                                              |

---

## 5. What changed in code this phase

- **API:** `instrumentation.ts` (OTel + Sentry preload); `observability/logging/*` (pino + redaction);
  `observability/metrics/*` (registry, `/metrics`, HTTP interceptor, business counters);
  `observability/tracing/*` (`TracedWorkerHost`, `withJobSpan`); the six workers converted to
  `TracedWorkerHost`; upload hardening in `partner-delivery.controller.ts` +
  `shared/presentation/upload/image-signature.ts`; new env vars (observability) with a cross-field
  rule; `/metrics` excluded from the global prefix.
- **Admin:** `@sentry/nextjs` wiring (`instrumentation.ts`, `instrumentation-client.ts`,
  `withSentryConfig`).
- **Mobile:** `sentry_flutter` wrapping `main()`, DSN via `--dart-define`.
- **Load:** `apps/api/load/*` k6 scripts + README.
- **Tests:** unit specs for the magic-byte sniffer, the metrics service, and the log correlation/
  redaction config.
