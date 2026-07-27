# Circular Paper Economy

Newspaper subscription → scheduled recyclable paper pickup → digital weighing →
cashback → recycling partner handoff → sustainability reporting → marketplace.

> **Status: Phase 15 — deployable.** The whole platform now has a deployment path: **Kustomize
> manifests** for the API, a dedicated **BullMQ worker** (the sole cron scheduler), Redis, and the
> admin console — with resource limits, liveness/readiness probes, HPAs and PodDisruptionBudgets.
> **GitHub Actions** builds immutable images on merge, auto-deploys to **staging**, then holds at a
> **manual approval gate** before production, running **`prisma migrate deploy` as a separate, gated
> step** before any rollout. A **Flutter pipeline** builds signed Android/iOS artifacts on a
> `mobile-v*` tag and promotes them to the store **internal tracks** behind a manual gate. **Secrets
> never touch the repo** (External Secrets Operator; the env schema fails fast without real ones).
> Operations are documented in the **[runbook](docs/runbook.md)** — deploy, roll back, check health,
> and what to do when the wallet-credit job pages you at 2am.
>
> _Prior phase (14 — observability & security): structured JSON logs with end-to-end correlation
> ids, OpenTelemetry traces (HTTP/DB/BullMQ), a Prometheus `/metrics` endpoint, Sentry across all
> three apps, and a clean OWASP API Top 10 pass but for the upload hardening it fixed. See
> [`docs/phase-14-production-readiness.md`](docs/phase-14-production-readiness.md)._
>
> ⚠️ **Read [Regulatory: the wallet is not a licensed instrument](#regulatory-the-wallet-is-not-a-licensed-instrument) before piloting with real money.**
>
> 📋 **[Production readiness](#production-readiness) — what is and is not ready to deploy.**

---

## Repo layout

```
apps/
  api/            NestJS backend (TypeScript, Prisma, PostgreSQL, Redis)
  admin/          Next.js internal ops dashboard (ops / support / finance / QC)
  mobile/         Flutter app (customer + delivery partner)
packages/
  shared-types/   TS contracts shared by api and admin (OpenAPI-generated later)
infra/
  docker/         docker-compose for local dev, production Dockerfiles
  k8s/            Kubernetes manifests (shape only until Phase 15)
.github/
  workflows/      CI
```

The TypeScript side is a **pnpm workspace**. `apps/mobile` is a Flutter package and
is deliberately _not_ part of it — it has its own toolchain (`pub`) and is excluded
from `pnpm-workspace.yaml`.

### Why an admin dashboard at all

It was not in the original spec. Ops, support, finance and QC teams need to look up
"why does this user's wallet say ₹240", reassign a delivery run, and verify a
recycling partner. That is a desk job on a large screen, so it is a web app —
Next.js, sharing types with the API. Phase 9 builds it out.

---

## Prerequisites

| Tool    | Version | Notes                                     |
| ------- | ------- | ----------------------------------------- |
| Node    | 22+     | `.nvmrc` pins it                          |
| pnpm    | 11+     | `corepack enable` is the easiest way      |
| Docker  | any     | for local Postgres + Redis (Podman works) |
| Flutter | 3.44+   | only if you are working on `apps/mobile`  |

---

## Getting started

```bash
# 1. Install TypeScript dependencies (also generates the Prisma client)
pnpm install

# 2. Start Postgres and Redis
pnpm dev:infra

# 3. Create local env files from the templates
cp apps/api/.env.example       apps/api/.env
cp apps/admin/.env.example     apps/admin/.env.local

# 4. Apply migrations
pnpm --filter @cpe/api exec prisma migrate deploy
```

To log in locally, request an OTP and read the code from the API log — the `console`
SMS provider prints it rather than sending it:

```bash
curl -X POST localhost:3000/api/v1/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"phone":"9876543210"}'
# the code is printed in the `pnpm --filter @cpe/api dev` output
```

### Running each app

| App      | Command                         | URL                          |
| -------- | ------------------------------- | ---------------------------- |
| API      | `pnpm --filter @cpe/api dev`    | http://localhost:3000/api/v1 |
| API docs | —                               | http://localhost:3000/docs   |
| Admin    | `pnpm --filter @cpe/admin dev`  | http://localhost:3001        |
| Mobile   | `cd apps/mobile && flutter run` | emulator / device            |

Health probes sit **outside** the version prefix, at `/health/live` and
`/health/ready`, because that is where the Kubernetes probes point. Do not move them.

### Working on the Flutter app

Generated files (`*.g.dart`, `*.freezed.dart`) are **not committed** — they are a
pure function of the source, and committing them turns every dependency bump into a
thousand-line diff. Generate them after checkout, and re-run on changes to any
annotated class:

```bash
cd apps/mobile
flutter pub get
dart run build_runner build          # or: watch
flutter analyze
flutter test
```

Point the app at a local API (10.0.2.2 is how the Android emulator reaches your host):

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

---

## Repo-wide commands

Run from the root; each fans out across the workspace in dependency order.

```bash
pnpm build        # shared-types -> api + admin
pnpm lint         # eslint, zero warnings tolerated
pnpm typecheck    # tsc --noEmit
pnpm test         # unit tests
pnpm format       # prettier --write

pnpm dev:infra          # start postgres + redis
pnpm dev:infra:down     # stop, keep data
pnpm dev:infra:reset    # stop and DELETE volumes
```

---

## Environment variables

**Never commit a real secret.** `.env*` is gitignored except `*.env.example`, and the
same rule holds for Kubernetes Secrets: base64 is an encoding, not encryption.

| File                                     | Purpose                                    |
| ---------------------------------------- | ------------------------------------------ |
| `apps/api/.env.example`                  | template → copy to `apps/api/.env`         |
| `apps/admin/.env.example`                | template → copy to `apps/admin/.env.local` |
| `infra/k8s/base/api-secret.example.yaml` | which secret keys the API expects          |

Conventions:

- **The API validates its environment at boot** (`apps/api/src/config/env.schema.ts`,
  Zod). A missing or malformed variable crashes the process on startup with a message
  naming the variable, rather than surfacing as `undefined` inside a wallet-credit job
  at 2am. Nothing outside that file reads `process.env`.
- **`NEXT_PUBLIC_*` is public.** Next inlines those into the browser bundle at build
  time. A secret behind that prefix is a published secret. Server-only values are read
  without the prefix, in a Server Component / Route Handler / Server Action.
- **The mobile app gets config via `--dart-define`,** not a bundled file. An app
  bundle is readable by anyone who unzips the APK; a mobile app cannot hold a secret.
- Adding a variable means: add it to `env.schema.ts`, to the matching `.env.example`,
  and to `infra/k8s/base/api-config.yaml` (non-secret) or the secret store.

---

## Architecture

### API — Clean Architecture, feature-first

Every feature module owns four layers, and **dependencies only ever point inward**:

```
src/modules/<feature>/
  domain/          entities, value objects, ports (interfaces). Framework-free.
  application/     use cases. Orchestrates domain; depends only on ports.
  infrastructure/  adapters: Prisma repositories, HTTP clients, queue workers.
  presentation/    controllers, DTOs, guards. The HTTP edge.
  <feature>.module.ts   the composition root — the only file that binds a port
                        to its implementation.
```

`src/modules/health/` is the reference implementation. It is small on purpose; read
it before adding a module. It demonstrates the port/adapter split
(`HealthProbe` + `HEALTH_PROBES` token), a use case that depends only on the
interface, two infrastructure adapters, and the module that wires them.

This is enforced, not merely documented: ESLint fails the build if anything under
`modules/*/domain/**` imports `@nestjs/*`, `@prisma/*`, `bullmq` or `express`
(see `eslint.config.mjs`). A domain that quietly grows a framework dependency is how
Clean Architecture degrades into folders that merely look tidy.

The payoff is concrete: the Phase 4 wallet ledger and the Phase 2 subscription state
machine — the two places where bugs cost real money — become testable without a
database, an HTTP server or a queue.

### Shared code

`src/shared/` holds cross-cutting concerns (Prisma and Redis connections, the
correlation-ID middleware, the exception filter, the framework-free `DomainError`
hierarchy). `AllExceptionsFilter` is the single place an exception becomes an HTTP
response, so every error leaves the API in the one `ApiErrorResponse` shape that
`@cpe/shared-types` declares and both clients parse.

### Mobile — feature-first

```
lib/
  core/            config, router (GoRouter), network (Dio), database (Drift), theme
  features/<f>/
    data/          DTOs + repository implementations. The only layer that knows Dio.
    domain/        entities + repository interfaces. Pure Dart.
    presentation/  screens + Riverpod controllers.
```

`features/home/` is the reference implementation, wired through the whole stack
(Riverpod → repository interface → Dio → the API's `/health/live`). Its widget test
fakes the repository _interface_ — no HTTP mock, no running server — which is the
concrete payoff of the domain/data split.

---

## CI

`.github/workflows/ci.yml`, on every PR to `main`:

- **TypeScript** — install (frozen lockfile) → prisma validate → lint → typecheck →
  build → unit tests → migrate → e2e against real Postgres and Redis service containers.
- **Flutter** — format check → codegen → `flutter analyze` → `flutter test`.

Path filters skip the Flutter job on API-only PRs and vice versa. The single required
status check is the `CI` job, which aggregates the others.

The e2e tests call the same `configureApp()` that `main.ts` does. This is not
incidental: when the test harness configured the app differently from production, the
suite passed against health routes that the deployed server did not actually serve.

---

## Auth (Phase 1)

Customers authenticate by phone OTP; there is no customer password at all. Staff
(`OPS_STAFF`, `SUPER_ADMIN`) additionally have email + Argon2id password login.

```
POST /api/v1/auth/otp/request   { phone }                 -> 200 (always, for a valid number)
POST /api/v1/auth/otp/verify    { phone, code }           -> 200 { accessToken, refreshToken, isNewUser }
POST /api/v1/auth/staff/login   { email, password }       -> 200 { accessToken, refreshToken }
POST /api/v1/auth/refresh       { refreshToken }          -> 200 (rotates)
POST /api/v1/auth/logout        { refreshToken }          -> 204 (idempotent)
```

Locally the `console` SMS provider prints the code to the API log instead of sending
it. The API **refuses to boot** with `NODE_ENV=production` and `SMS_PROVIDER=console`
— that combination would mean no user ever receives a code and every code is written
to the log stream. A real provider (MSG91/Twilio) is a new class implementing
`SmsProvider` plus one line in the enum; no use case changes.

### The decisions worth knowing

- **Authentication is default-deny.** `JwtAuthGuard` is registered globally, so a new
  endpoint is protected unless someone writes `@Public()`. The opposite arrangement
  fails open: the one controller you forget to guard ships unauthenticated.
- **The guard re-reads the user from the database on every request.** A JWT is frozen
  at issue time, so without this a suspended user keeps access until their token
  expires, and a demoted admin keeps admin rights. For a system that moves money that
  window is unacceptable; the cost is one indexed primary-key lookup.
- **Refresh tokens rotate, and reuse is treated as theft.** Every refresh revokes the
  presented token and issues a successor in the same _family_. Presenting an
  already-revoked token means it was captured and replayed — we cannot tell victim
  from thief, so the whole family is revoked and both must log in again. Other devices
  (separate families) are unaffected.
- **OTPs are Argon2id-hashed, never stored or logged in plaintext.** Six digits is only
  10^6 possibilities, so a fast hash would be cracked instantly from a leaked table.
  Refresh tokens use SHA-256 instead — they are 256 bits of CSPRNG output, so there is
  no dictionary to grind and Argon2 would only add latency. Two ports (`SecretHasher`,
  `TokenHasher`) keep that choice explicit rather than accidental.
- **Rate limiting is per-phone AND per-IP, both in Redis.** Per-phone alone lets one
  host walk the number space; per-IP alone lets a botnet SMS-bomb one victim (and bill
  us for every message). Both `@nestjs/throttler` and the OTP budget are backed by
  Redis — the library's default in-memory store is per-process, so N replicas would
  silently mean N× the budget.
- **Enumeration is closed off.** `otp/request` answers identically for registered and
  unregistered numbers; wrong-code, expired, and already-used all return one vague
  error; staff login returns the same error for an unknown email as for a wrong
  password (and burns equivalent CPU, so latency does not leak either).
- **Ownership checks return 404, not 403.** A 403 on someone else's address would
  confirm the id is real and let an attacker enumerate ids.

`trust proxy` is set to `1` in `configureApp`. It must match the number of proxy hops
in front of the API: too low and every client shares one rate-limit bucket, too high
(or `true`) and a client can spoof `X-Forwarded-For` to mint unlimited buckets.

## Catalogue & subscriptions (Phase 2)

```
GET  /api/v1/catalog/editions?pincode=560038&language=KANNADA   browse what you can actually buy
GET  /api/v1/subscriptions/quote?editionId=…&frequency=DAILY…   what would this cost?
POST /api/v1/subscriptions                                      subscribe
POST /api/v1/subscriptions/:id/{pause,resume,cancel}            lifecycle
POST /api/v1/subscriptions/:id/change-address
GET  /api/v1/subscriptions/:id/charge-preview                   prorated charge for this period
POST /api/v1/admin/catalog/{publishers,newspapers,editions}     OPS_STAFF / SUPER_ADMIN only
```

`pnpm --filter @cpe/api exec prisma db seed` loads a realistic catalogue (7 publishers,
11 newspapers across 7 Indian languages, 15 city editions). It is idempotent — it
upserts on natural keys rather than truncating, so it will not wipe a database that has
real subscriptions in it.

### Money is integer paise. Everywhere.

Never a float, never a `Decimal`, never rupees. Every money value here gets multiplied
(price × issues), split (proration) or summed (the Phase 4 ledger), and integers make
those operations exact and associative. Rupees exist only at the presentation edge, as
a formatted **string** — `450 / 100` is `4.5` in JavaScript, and a client that renders
that shows "₹4.5".

### Why proration has no rounding step

**A newspaper is priced per ISSUE, not per month.** So a bill is a count, not a
division:

```
amount = pricePerIssue × (issues actually delivered)
```

The obvious alternative — `monthlyPrice × daysActive / daysInMonth` — is where the
off-by-one billing bugs in this class of system come from. It needs a rounding rule;
that rule has to stay consistent across start, pause, resume and cancel; February and
31-day months disagree; and the rounded halves of a split month don't add back up to
the whole. Counting issues has none of those problems: 450 paise × 26 issues = 11,700
paise, exactly, on any calendar. There's a test asserting the two halves of a split
month sum to the whole, precisely because the naive formula fails it.

Consequences worth knowing:

- **Days are a `Day` value object, not a `Date`.** An instant is "the 17th" in
  Bengaluru and "the 16th" in London, so a `Date` would make a subscription's first
  billable day depend on who's asking, and every boundary test a coin flip.
- **Ranges are inclusive at both ends.** Subscribe on the 17th of a 31-day month and
  you're billed 15 issues, not 14. Cancel on the 10th and you're billed for the 10th —
  you got that morning's paper.
- **`resumedFrom` is the first day delivery RESUMES**, so the last paused day is the day
  before. Reading it as inclusive-of-pause would make every pause one day too generous.
- **Pauses are an append-only log**, not two columns on the subscription. A customer who
  pauses twice in a month has two windows; collapsing them would lose one and
  overcharge. A partial unique index enforces at most one _open_ pause.
- **The price is copied onto the subscription at signup.** An admin raising the
  catalogue price does not silently re-bill existing subscribers, and every past invoice
  still recomputes to the figure it was issued at.

### The state machine

`ACTIVE ⇄ PAUSED`, both → `CANCELLED`, and **`CANCELLED` is terminal**. One transition
table in `subscription-state-machine.ts` answers every lifecycle question. The
alternative — an `if (status !== 'CANCELLED')` here, a `status === 'PAUSED'` there — is
how a subscription becomes resumable after cancellation: not because anyone decided
that, but because one of five scattered checks forgot a case.

Redundant transitions are **errors, not silent no-ops**: pausing an already-paused
subscription returns 409, because accepting it would open a second pause window and
credit the same skipped issues twice.

Status changes only ever happen through `POST /:id/pause|resume|cancel`. There is
deliberately no `PATCH { status }` — a client that can send `{"status":"ACTIVE"}` can
drive the subscription into any state it likes, and the transition table becomes
advisory.

### Delivery footprint

An edition lists the pincodes it's actually delivered to. Subscribing — and changing
address — is refused (`PINCODE_NOT_SERVICED`) outside that list, and the browse endpoint
never shows an edition you can't buy. The failure this prevents is the worst kind: a
customer who subscribes successfully, is billed successfully, and receives nothing,
because it looks like success to everyone until they complain.

## Delivery (Phase 3)

```
GET  /api/v1/delivery/my-runs?date=…                partner: today's run sheet
POST /api/v1/delivery/stops/:id/photo               partner: proof photo (multipart)
POST /api/v1/delivery/stops/:id/outcome             partner: DELIVERED / FAILED / SKIPPED
POST /api/v1/admin/delivery/zones                   ops: define a zone (pincode list)
POST /api/v1/admin/delivery/partners                ops: onboard (KYC starts PENDING)
PATCH /api/v1/admin/delivery/partners/:id           ops: verify KYC, offboard, set zones
POST /api/v1/admin/delivery/plan                    ops: force a re-plan (idempotent)
GET  /api/v1/admin/delivery/completion?date=…       ops: completion rates
POST /api/v1/admin/delivery/runs/:id/reassign       ops: hand a run to another partner
ws://…/delivery                                     ops: live feed (staff only)
```

A **nightly BullMQ job** (`DELIVERY_PLANNER_CRON`, 21:00 by default) turns tomorrow's
active subscriptions into run sheets. `POST /admin/delivery/plan` runs the same code, so
ops can re-plan immediately after fixing a zone rather than waiting for the cron.

### The planner is a pure function

`planRuns()` takes subscriptions + zones + partners + a date and returns a plan. No
database, no clock, no queue. That's deliberate: this is the piece most likely to be
wrong, and every case the brief warns about is testable as arithmetic (32 unit tests)
rather than as a fixture and a job run.

What it gets right, and why each one matters:

- **Load is balanced across a partner's TOTAL day, not per zone.** A partner who works
  two zones would otherwise get a full round in each — double everyone else's. This is
  the "partners in overlapping zones" bug, and naive round-robin walks straight into it.
- **A pincode in two zones produces exactly ONE stop**, with the tie broken
  deterministically (lowest zone id) and the overlap reported. Two stops means the
  customer gets two papers and you pay two partners for one delivery. Picking
  _arbitrarily_ would make the job non-deterministic — a different run sheet every night,
  and no way to reproduce a complaint.
- **Unassignable customers are reported, never dropped.** `NO_ZONE` (no zone covers their
  pincode) and `NO_PARTNER` (nobody active, available and KYC-verified) are returned and
  logged at error level. A silently-dropped customer is billed and receives nothing —
  the failure that looks like success to everyone until they call.
- **Only KYC-VERIFIED partners are ever assigned work**, and reassignment enforces the
  same bar. "Just let them work until verification comes through" is precisely what KYC
  exists to prevent: an unvetted stranger with a list of customers' home addresses.
- **It reuses Phase 2's delivery calendar.** If delivery had its own notion of "is today
  a delivery day", the two would drift and you'd bill for issues you never printed a run
  sheet for. One calendar, both answers — including the pause windows and the inclusive
  cancellation day.

Idempotency is enforced by `@@unique([runDate, partnerId, zoneId])`: a retry, a manual
kick, or two workers racing collide on the index rather than issuing a partner a second
run sheet mid-round.

### Recording a delivery

An outcome is **recorded once**. A partner on a flaky mobile network _will_ double-submit,
so the write is a conditional `UPDATE … WHERE status = 'PENDING'` — the second request
gets a 409 instead of silently overwriting the first one's reason, photo and timestamp.
By Phase 4 that record decides whether the customer is billed.

`FAILED` and `SKIPPED` must carry a reason; `DELIVERED` must not. Enforced in the domain
_and_ as a DB check constraint — application-only is one bad write path from being untrue,
DB-only surfaces as a 500. "Failed" with no reason is a dispute nobody can settle.

Photo upload is a **separate call** from recording the outcome, so a failed 3MB upload on
a bad connection doesn't throw away the fact that the paper was delivered (and Phase 13's
offline queue can retry the two independently). Storage goes through a `StorageProvider`
port — swapping the local dev adapter for S3/MinIO/R2 is one class and one line of
wiring. Photos are served as **short-lived signed URLs**: they show the inside of a
customer's doorway, and object keys are guessable enough that "nobody will find it" is not
a security model.

### The WebSocket is authenticated separately — and that's not optional

The global `JwtAuthGuard` is an **HTTP** guard; a socket handshake never passes through
it. The gateway therefore authenticates its own connections and checks the role **from the
database**, exactly like the HTTP guard. Get this wrong and a "secured" API leaks a live
feed of where customers live to anyone who opens a socket. Anonymous and non-staff
connections are refused.

Publishing can never fail a delivery: the partner is standing at a door and the record is
already in Postgres, so a dead socket is cosmetic and the dashboard refetches.

## Pickup, weighing & wallet (Phase 4)

```
POST /api/v1/pickups                               customer: request a collection (returns a QR token)
POST /api/v1/pickups/:id/cancel                    customer: cancel (refused once completed)
POST /api/v1/delivery/pickups/scan                 partner: scan the QR at the door
POST /api/v1/delivery/pickups/quote                partner: show the customer the figure first
POST /api/v1/delivery/pickups/:id/complete         partner: weigh + pay        [Idempotency-Key REQUIRED]
GET  /api/v1/wallet                                customer: balance
GET  /api/v1/wallet/transactions                   customer: the ledger
POST /api/v1/wallet/withdrawals                    customer: request a payout  [Idempotency-Key REQUIRED]
POST /api/v1/admin/rates                           ops: publish a versioned rate card
GET  /api/v1/admin/wallet/withdrawals              ops: the payout queue
POST /api/v1/admin/wallet/withdrawals/:id/approve  ops: approve (does NOT send money)
POST /api/v1/admin/wallet/withdrawals/:id/reject   ops: reject (reversal credit)
POST /api/v1/admin/wallet/withdrawals/:id/mark-paid ops: confirm the transfer went out
GET  /api/v1/admin/wallet/users/:id/reconcile      ops: replay the ledger vs the cached balance
POST /api/v1/admin/wallet/adjustments              ops: manual correction      [Idempotency-Key REQUIRED]
```

Pickups **ride along with the delivery round**. The nightly job plans delivery runs, then
slots that day's pickups into them: the partner is already walking the street with the
morning papers and collects the old ones on the same pass. Sending a second person would
double the cost of the entire circular model — that co-location _is_ the economic argument
for the product.

### Regulatory: the wallet is not a licensed instrument

**This is a legal question, not an engineering one, and it is not solved in code.**

Cashback held as a redeemable balance may fall under the RBI's **Prepaid Payment
Instrument (PPI)** regulations. Whether it does depends on how the instrument is
structured, and the distinction that matters is roughly:

- a **closed** wallet (spendable only inside your own marketplace, never withdrawable to a
  bank) generally sits outside PPI licensing; whereas
- a **semi-closed** wallet that can be **cashed out to a bank account** — which is exactly
  what `POST /wallet/withdrawals` does — is the case that attracts scrutiny, and KYC,
  escrow and licensing obligations may follow.

The code is deliberately built so this decision can be made _later_, by someone qualified,
without a rewrite:

- **Nothing auto-disburses.** Approving a payout and recording that the money actually left
  the bank are two separate, human, `OPS_STAFF` actions. There is no code path from
  "customer requested" to "money sent".
- The withdrawal flow is one module and one state machine. If counsel says "closed wallet
  only", you delete the withdrawal endpoints and the wallet becomes marketplace-only credit
  (Phase 8) — the ledger, the cashback and the pickup loop are all untouched.

Get this signed off before a pilot moves real money. Do not let it block building.

### The ledger

**Append-only, enforced by a Postgres trigger.** `UPDATE` and `DELETE` on
`wallet_transactions` are rejected by the database. Not a convention, not a code-review
rule — a ledger whose rows can change after the fact cannot settle a dispute or answer an
auditor, and "we agreed not to do that" is not a control. Corrections are a **new**
`ADJUSTMENT` row, attributed to the staff member who made it, with a note an auditor will
read. There are tests asserting the trigger fires.

**The wallet balance is a cache; the ledger is the truth.** Every entry stores the
`balanceAfter` it produced, so the ledger is self-verifying: replay it and every step must
match. `GET /admin/wallet/users/:id/reconcile` does exactly that, and it is the answer to
_"why does my wallet say ₹240"_.

**Concurrency is handled by `SELECT … FOR UPDATE` on the wallet row.** Without it, two
simultaneous cashback credits both read balance=1000, both write balanceAfter=1500, and one
silently vanishes — the customer is paid once for two pickups and the only trace is a ledger
that stops reconciling. There is a test that fires **12 concurrent credits at one wallet**
and asserts the balanceAfter values form an unbroken chain.

### Money and weight

Weight is **integer grams**; money is **integer paise**; balances are **BigInt**. A JS
`number` silently corrupts values past ~₹90 trillion, so every money value leaves the API as
a **string**.

`weightGrams × ratePerKgPaise / 1000` is fractional in general (1235 g at ₹14.99/kg =
1851.265 paise), so rounding is unavoidable. What is avoidable is rounding in more than one
place. **There is exactly one rounding point in the whole money path:** each line item is
rounded half-up, once, and stored — and the wallet credit is the _exact sum of the stored
lines_. So the ledger always reconciles against the receipt the customer was shown. (Note
this deliberately differs from rounding the exact grand total: three lines of 1.499 paise
pay 3, not 4. There's a test.)

Rates are **versioned, never edited**. A `PickupItem` snapshots the rate that applied when
it was weighed, so publishing a new card changes what _future_ pickups pay and nothing else.
Recomputing history from a mutable rate table is how a cashback ledger stops reconciling.

### Paying twice is the one failure this product cannot absorb

A delivery partner completing a pickup is standing in a doorway on 2G with a spinner on
screen. **They will double-submit.** There are three independent defences, and any one of
them alone would be sufficient:

1. **`Idempotency-Key`** (required by the interceptor). A replay returns the _stored_
   response without running the handler. The same key with a **different body** is a 409 —
   silently returning the cached answer would be the wrong answer to a new question.
2. **A conditional `UPDATE … WHERE status = 'ASSIGNED'`** claims the pickup. The loser of a
   race finds `count === 0` and the whole transaction is abandoned.
3. **`wallet_transactions.pickupId` is UNIQUE.** Even a completely bypassed key cannot
   double-credit a pickup — the database refuses.

The credit, the pickup completion and the item rows are one `$transaction`. There is a test
that poisons it to fail at the _last_ step and asserts **no partial state**: the pickup is
still `ASSIGNED`, no items were written, and no money moved.

### Withdrawals debit at REQUEST time

Not at approval. If the money stayed in the wallet until ops got round to reviewing, a
customer could request their full balance twice — or spend it in the Phase 8 marketplace
with a payout pending — and one of those two promises would have to be broken. A rejection
appends a **reversal CREDIT**; the original debit is never erased, and the customer's
statement shows both.

## Recycling & chain of custody (Phase 5)

```
POST /api/v1/admin/recycling/partners                    ops: onboard a mill (starts PENDING)
PATCH /api/v1/admin/recycling/partners/:id               ops: verify / suspend
POST /api/v1/admin/recycling/batches/run                 ops: force a batching run (idempotent)
POST /api/v1/admin/recycling/batches/:id/close           ops: OPEN -> READY, fixes the weight
POST /api/v1/admin/recycling/batches/:id/dispatch        ops: put it on a truck to a mill
POST /api/v1/admin/recycling/dispatches/:id/confirm      ops: record the mill's weighbridge reading
POST /api/v1/admin/recycling/dispatches/:id/reject       ops: the mill refused the load
GET  /api/v1/admin/recycling/dispatches/flagged          ops: the discrepancy incident queue
GET  /api/v1/admin/recycling/batches/:id/chain-of-custody  the full forward trace
GET  /api/v1/admin/recycling/customers/:id/trace           where did THIS customer's paper go
```

A **nightly job** (`BATCHING_CRON`, 04:00) sweeps completed pickups into collection batches,
grouped by `(zone, paperType)` — a mill buys newsprint and cardboard as separate products and
weighs them separately, so a truck of both is two loads sharing a chassis. Grouping is
deliberately simple: no nearest-mill routing, no load consolidation, no capacity-aware
packing. Those are real optimisations that can't be designed before real mills quote real
prices for real load sizes, and inventing constraints now would be worse than leaving them.

### The chain of custody is an explicit FK chain

```
PickupItem → CollectionBatch → BatchDispatch → RecyclingPartner
```

Every link is a real foreign key, never an inferred join on dates and zones. This is what an
ESG auditor is actually asking for behind "substantiate that tonnage": every gram attributed
to the customer who handed it over, the partner who collected it, the truck it rode on, and
the mill that weighed it at the far end. `chain-of-custody` walks it forwards; `trace` walks
it back from a customer. Phase 6's environmental claims are only as credible as this chain,
so it is made of columns you can query, not assertions you have to trust.

`chain-of-custody` also returns `itemsReconcile`: the batch's cached weight must equal the sum
of its items, the same relationship the wallet balance has to its ledger. If it's ever false,
no ESG number built on that batch is defensible.

### Discrepancy: record both weights, overwrite neither

Two real measurements — what we weighed at the door, what the mill weighed at the gate — taken
by different parties, with different instruments, hours apart. They will not agree, and that's
not a bug: paper loses moisture in transit, some spills, a weighbridge has its own tolerance.

The system records the mill's reading **alongside** our collected weight, never on top of it.
The gap between them _is_ the finding. Overwrite one with the other and you've destroyed the
only evidence that anything happened — and with it any chance of noticing that one
transporter's loads always arrive 12% light. A gap within `WEIGHBRIDGE_TOLERANCE_PERCENT` is
physics; beyond it is an incident that lands on the flagged queue and in an ERROR log. The
discrepancy is stored in signed **basis points** (integers), for the same reason money is in
paise: it gets compared to a threshold and shown to a mill in a commercial dispute, and a
float that renders as 2.4999998% in one report and 2.5% in another is an argument nobody wants.

Verified mills only — the same KYC bar as delivery partners. An unverified mill is a stranger
you'd be handing tonnes of a customer's property to.

## Sustainability impact (Phase 6)

```
GET  /api/v1/impact/me                              customer: my recycling impact
GET  /api/v1/admin/impact/platform                  ops: whole-platform totals
GET  /api/v1/admin/impact/users/:id                 ops: a customer's impact (support / their ESG)
GET  /api/v1/admin/impact/apartments/:id            ops: an apartment's aggregate (zero until Phase 7)
GET  /api/v1/admin/impact/businesses/:id            ops: a business's aggregate for their CSR report
POST /api/v1/admin/impact/refresh                   ops: force a cache recompute
```

Each report is **lifetime totals + a monthly trend**, served from a nightly cache
(`IMPACT_AGGREGATION_CRON`, 05:00 — after batching), because these numbers are read far more
than they change.

### Defensibility is the whole feature

Every figure is `confirmed-recycled kg × a coefficient`, and when a business customer's ESG
auditor asks _"where did this number come from"_, the answer is a citation, not a shrug. The
conversion factors live in exactly **one** constant (`sustainability-factors.ts`), each with
its source inline, and **golden tests lock every value** — edit a coefficient and the suite
fails, forcing a reviewed conversation, because a silent change would rewrite every historical
impact number the platform ever showed.

Two honestly-labelled tiers of rigour, because conflating them is how a sustainability
platform ends up in a greenwashing complaint:

- **CO2e avoided** — the **US EPA WARM model**, the methodology regulators and auditors
  accept. `rigour: MODELLED`. The CO2 factors are deliberately the _conservative_ end of the
  WARM range, so the platform under-claims.
- **Water, energy, trees** — widely-published paper-recycling figures with weaker primary
  provenance. `rigour: ESTIMATE`, and every label says "estimated".
- **Landfill diversion** — definitional (mass recycled = mass not landfilled). `rigour:
MEASURED` — the one figure that needs no coefficient.

Every response carries the `methodology` block and a `disclaimer`, and there is a test — a
literal grep over the module source _and_ over the live HTTP response — asserting the words
"carbon negative", "carbon neutral", "net zero" and "certified offset" never appear as claims.
The brief said cap claims to what the methodology supports; that's enforced, not just intended.

### What counts, and when

Impact is only credited for paper a **mill has CONFIRMED receiving** — walked all the way down
the Phase 5 chain of custody to a weighbridge confirmation. Paper we collected but that is
still in the warehouse is not recycling that has _happened_, and claiming it would be counting
credit we haven't earned. There's a test proving unconfirmed paper yields zero impact.

The nightly job caches the **raw measured grams** (per user, month, paper type), not the
derived impact — so the day a factor is re-verified against a new WARM version, every dashboard
reflects it on the next read with no stale CO2 figures to invalidate. Same principle as
deriving a wallet balance from its ledger. The domain calc is full-precision (rounding happens
once, at the DTO edge), so per-user, per-org and per-platform totals reconcile exactly.

Org dashboards (`apartments`, `businesses`) roll up over member users via a resolver that
returns empty until **Phase 7** wires membership — so a business admin sees an honest "0 kg so
far" rather than a 500, and the dashboards light up in Phase 7 with no change to this engine.

## Organisational accounts (Phase 7)

```
GET/POST/DELETE /api/v1/orgs/:orgType/:orgId/members         manage residents/employees
GET  /api/v1/orgs/:orgType/:orgId/impact                     the org's aggregate recycling impact
POST /api/v1/orgs/:orgType/:orgId/pickups                    schedule a common-area / bulk pickup
POST/GET /api/v1/orgs/:orgType/:orgId/contracts             flat-monthly or per-kg contracts
POST/GET /api/v1/orgs/:orgType/:orgId/invoices              generate (idempotent) + list invoices
GET  /api/v1/orgs/:orgType/:orgId/esg-report?yearMonth=…     download the ESG report PDF
```

`:orgType` is `apartments` or `businesses`. Apartments and businesses become multi-user
tenants, and Phase 6's org impact dashboards — which reported zero behind a stubbed resolver —
now light up, because the membership resolver is backed by the real member table.

### Tenant isolation is the whole point, and it lives at the query layer

The brief called this out as the phase's priority, and it is enforced where it must be — not
in the UI. Every org operation resolves the caller's memberships **fresh from the database**
(never from the token; an admin's grant can be revoked mid-session) and passes them through one
pure gate (`tenant-access.ts`) before any data is touched. A real, authenticated org admin
reaching for another org's `:orgId` gets a **403 that reveals nothing** — same response whether
the target exists or not.

Because every path goes through that gate, isolation is a property of the module, not of each
author remembering a `where` clause. The e2e suite is deliberately adversarial: it logs in as a
genuine business admin and tries to read, write, invoice, and pull the ESG report of _another_
business — every one returns 403. It also proves a plain **member** (belonging ≠ administering)
and a customer with no org role are refused, and that an apartment id cannot be used to reach a
business (the check keys on kind, not just id).

Two governance rules are enforced in the database, not just code: **one admin per org** (a
single accountable owner; partial unique index) and **exactly one org per membership/contract**
(check constraint). An admin cannot remove themselves and orphan the org.

### Contracts, invoices, and the ESG report

Contracts are **flat-monthly** or **per-kg**. A per-kg invoice bills the org's
confirmed-recycled weight for the month (from Phase 6) × the rate, with the same
single-half-up-rounding-in-paise discipline the cashback ledger uses. Invoice generation is
**idempotent** — the `(contract, period)` unique index means a re-run returns the existing
invoice rather than double-billing — and the terms and amount are **snapshotted** onto the
invoice, so a later contract change never rewrites a past bill.

The **ESG report** is a downloadable PDF (`Content-Disposition: attachment`) built from the
Phase 6 sustainability figures, carrying the methodology block **and the honesty disclaimer on
the document itself** — a business puts this in their CSR filing, so "not a certified carbon
offset" has to travel with it, not sit in an API field nobody reads. Rendering goes through an
`EsgReportRenderer` port; the shipped adapter is **PDFKit** (chosen over Puppeteer to keep
Chromium — ~300 MB and a browser's attack surface — out of every pod), and swapping it for an
HTML export or a rendering microservice is one binding.

## Marketplace (Phase 8)

```
GET  /api/v1/marketplace/products                    browse (active products, verified sellers)
GET  /api/v1/marketplace/products/:slug              product detail
GET/POST/PUT /api/v1/marketplace/cart[/items[/:id]]  one live cart per user
POST /api/v1/marketplace/checkout                    snapshot prices, split wallet/gateway, start payment
GET  /api/v1/marketplace/orders[/:id]                my orders (status tracking)
POST /api/v1/marketplace/webhooks/payment            gateway → us (signed, idempotent)
POST /api/v1/admin/marketplace/sellers[/:id/transition]   onboard + verify/suspend/reinstate
POST /api/v1/admin/marketplace/products[/:id/...]         catalogue, variants, stock
POST /api/v1/admin/marketplace/orders/:id/fulfil          SHIP / DELIVER
```

The recycled paper that left in Phase 5 comes back as notebooks and stationery a customer can
buy — and pay for **partly with the wallet balance they earned recycling** (Phase 4), partly by
card. Money is integer paise end to end, as everywhere else.

### Order confirmation is atomic across three ledgers

Checkout snapshots each line's price onto an immutable order, splits the total between wallet and
gateway (`walletPaise + gatewayPaise = total`, a DB CHECK constraint, never trusted from the
client), and either **confirms synchronously** (fully wallet-paid — no external leg to wait on) or
returns a gateway handoff for the card leg. **Nothing moves until confirmation.**

Confirmation — triggered by the gateway's signed webhook — does three things in **one database
transaction**: decrement every line's stock, debit the wallet portion, capture the payment. If any
leg throws, all of it rolls back. The wallet debit reuses the Phase 4 ledger's exact primitive
(`WalletLedgerWriter`, shared into this transaction) rather than a second copy of "debit a wallet"
— an `ORDER_PAYMENT` row under the same row lock, with a partial-unique index guaranteeing **at
most one debit per order**. Because the two funding legs commit at different times (the card at the
gateway, the wallet in our DB), "atomic" is completed by a **compensating refund**: if the wallet
debit fails after the card was captured — the customer spent their balance elsewhere in between —
the order is failed and the gateway is refunded, so the two legs still settle as one outcome.

### The three properties the brief singles out, tested against real Postgres

- **Inventory never oversells under concurrency.** Stock is decremented with a conditional
  `UPDATE ... WHERE stock >= qty`; the loser of a race for the last unit matches zero rows and the
  order fails. A `stock >= 0` CHECK is the backstop. The e2e test fires **eight concurrent
  confirmations at three units** and asserts exactly three confirm, five sell out, and stock lands
  at zero — never negative.
- **Split-payment atomicity.** The test drains the wallet between checkout and webhook so the debit
  must fail, then asserts the order is FAILED, **stock was not decremented** (it rolled back with
  the failed debit — the proof), no `ORDER_PAYMENT` landed, and the gateway was refunded.
- **Webhook idempotency.** A gateway delivers the same event twice; the `(provider, eventId)` unique
  index, inserted inside the confirmation transaction, means the replay aborts and is a no-op. The
  test sends the identical webhook twice and asserts stock decremented once, wallet debited once,
  one webhook-event row.

### Payment gateway behind a port; sellers reuse the verification pattern

All business logic talks to a `PaymentGateway` port — no use-case or repository imports a vendor
SDK. **Razorpay** is the shipped adapter (plain REST over `fetch`, the default for Indian consumer
apps); a deterministic **in-process fake** backs local dev and tests, signing webhooks with the
same real HMAC-SHA256 scheme so the signature path is exercised for real (and refused in
production). Webhook signatures are verified over the **raw request bytes** with a constant-time
compare before anything is parsed. Sellers are verified through the **same
`PENDING → VERIFIED → SUSPENDED` lifecycle as recycling partners** (`shared/domain/partner-verification`),
not a bespoke per-partner-type flow — only a verified seller's products can go live.

## Ops console (Phase 9)

`apps/admin` is the internal staff dashboard (Next.js App Router, React 19, TanStack Query). It is
a pure consumer of the Phase 1–8 APIs — it adds no business logic of its own — and it exists so
support, ops and finance have one place to answer the questions the platform generates.

**Screens:** overview, live delivery runs, wallet oversight, recycling & chain-of-custody, org
accounts, marketplace/sellers, sustainability, and the audit log. Every screen is gated to the
roles the backend allows on the endpoints behind it — the nav hides what a role cannot reach, and
the API enforces the same roles on every call, so the gating is convenience, not the control.

### Admin and API cannot drift out of type sync

The admin's request/response types are **generated from the API's OpenAPI spec**
(`@nestjs/swagger` → `openapi-typescript`) into `@cpe/shared-types` and imported everywhere the
console touches the wire. `pnpm --filter @cpe/api gen:types` boots the app, emits the spec, and
regenerates the committed types; rename a field in a NestJS DTO without updating a consumer and the
**admin build fails**, rather than a support agent hitting a runtime surprise mid-incident.

### The two support workflows the brief singled out

- **"Why does this wallet say ₹X?"** — look up a customer by id and see the cached balance, the
  append-only ledger that produced it, **and a live reconciliation of the two**. Showing the
  reconciliation next to the balance is the point: it answers not just _what_ the balance is but
  _whether it can be trusted_ — an unreconciled wallet (a write that escaped the row lock) shows in
  red rather than being discovered later.
- **Reassigning a delivery run** — when a rider calls in sick mid-morning, reassign their run to a
  partner who can actually take it. The candidate list is filtered to verified, active, available,
  in-zone partners (offering an ineligible one just means the backend rejects it after the agent
  has told the customer it's sorted). Both workflows have component tests (Vitest + Testing
  Library) that assert the queries fire, the eligibility filter holds, and the mutation is sent.

### Live delivery feed

The delivery screen subscribes to the Phase 3 gateway (`/delivery` namespace) for a real-time tail
of stop-status changes. The access token goes in the socket handshake `auth` payload — never the
query string, which proxies and browser history log — matching how the gateway authenticates; only
staff sockets are admitted to the admin room.

### Audit log — one interceptor, not N controllers

A new `AuditLog` model records **who did what, to what, when**, written by a single global
interceptor. Scope is deliberate: only **mutations** (POST/PUT/PATCH/DELETE), only **staff/admin**
roles (a customer editing their own cart is not an admin action), only on **success**. The one
admin route a developer forgets to log by hand is exactly the action a reviewer later needs — doing
it in an interceptor means a new admin endpoint is audited the moment it exists, for free. Request
bodies are **redacted** before storage (passwords, tokens, OTP codes, bank details stripped by key
name) — an audit log that leaks credentials is a liability, not a control — and the write is
best-effort and off the response's critical path, so a broken audit pipeline can never turn a
committed admin action into a 500. The trail is readable at `/admin/audit`, filterable by actor,
action and target, and gated to OPS_STAFF/SUPER_ADMIN because the log of who-did-what is itself
sensitive.

> **Note on session storage.** The console keeps its tokens in `localStorage` — a reasonable trade
> for an internal, staff-only tool over TLS (survives refresh, no CSRF dance), and called out as
> deliberate rather than accidental. A public consumer app should prefer an httpOnly cookie.

## Push notifications (Phase 10)

```
POST /api/v1/notifications/devices            register a device (FCM/APNs token) — idempotent
POST /api/v1/notifications/devices/unregister forget a device
GET/POST /api/v1/notifications/preferences    per-category opt-out
GET  /api/v1/notifications                     my recent notifications
GET  /api/v1/admin/notifications/dead-letters  ops: pushes that permanently failed
```

Six event types notify the customer: **delivery completed, pickup collected + cashback credited,
withdrawal approved/rejected, subscription renewal reminder, order status change, pickup reminder.**

### Sending never blocks — or breaks — the thing that triggered it

Every trigger calls a `NotificationDispatcher` port and returns. The push itself — a slow, flaky,
third-party call — happens later on a **BullMQ queue**. Two rules make this safe:

- **`dispatch()` swallows its own errors.** A pickup is credited, a withdrawal is approved, an
  order is confirmed _whether or not_ the notification queue is even up. A lost notification is a
  bad day; a lost credit is a lawsuit. The trigger is fire-and-forget (`void dispatch(...)`).
- **A failed push is recorded, never dropped.** The worker turns per-device outcomes into a
  verdict (`retry-policy.ts`, pure and unit-tested): any device delivered → **SENT**; a transient
  failure → **throw so BullMQ retries** with exponential backoff (5s→10s→20s→40s); every device
  permanently dead, or attempts exhausted → **dead-letter** — a `FAILED` row with its error, listed
  at `/admin/notifications/dead-letters`. Dead device tokens the provider reports are deactivated
  so we stop pushing to them.

### FCM and APNs behind one interface

Business logic only ever sees `NotificationProvider`. A `CompositePushProvider` routes each send by
platform — Android to **FCM** (HTTP v1, service-account JWT over `fetch`, no `firebase-admin` SDK),
iOS to **APNs** (HTTP/2 + ES256 token auth). A deterministic in-process **fake** backs dev and
tests (a `dead-`/`flaky-` token prefix forces a permanent/transient failure, so the retry and
dead-letter paths are exercised without a device); it is refused in production. The one subtle,
shared concern is error **classification** — an unregistered/bad token is permanent (deactivate),
a quota/5xx is transient (retry) — because the whole retry policy hinges on getting it right.

### Preferences are opt-out, per category

A customer can silence renewal reminders without losing the "you were paid" push they actually
want. The default is **on unless a row says otherwise**, so a new category needs no back-fill, and
the opt-out is checked in **one place** — the dispatcher — so no individual trigger can forget it.

### Reminders fire once, not every day

The renewal and pickup reminders are daily BullMQ scans. The renewal one fires only when a
subscription is **exactly** the configured lead-days from renewal (not `<=`), so a customer gets
one reminder per cycle, not a nag every morning of the last three days — no dedup table needed
(`renewal-schedule.ts`, pure, handles month-length clamping and is unit-tested).

## Mobile app foundation (Phase 11)

`apps/mobile` is the Flutter app for **customers and delivery partners** — ONE app with
role-based navigation, not two. (The build plan flagged this as a choice; a separate partner app
is common, but one app with a role guard is simpler to ship and keeps a single auth/design spine.
The role split is one `redirect` rule, so carving out a separate partner app later is a small
change, not a rewrite.) Phase 11 is the foundation the feature screens (Phase 12+) hang on.

### Auth spine

- **OTP login** (`/login` → `/otp`), wired to the Phase 1 auth API. The screens are non-oracles:
  the "code sent" message is identical whether or not the number is registered, matching the API.
- **Tokens in the OS keystore** via `flutter_secure_storage`, never `SharedPreferences` (which is a
  plaintext file any backup or rooted device can read). Behind a `TokenStore` interface, so tests
  use an in-memory fake instead of a platform channel that does not exist under `flutter test`.
- **A Dio interceptor that recovers from a 401**: attach the access token, and on a 401 refresh
  once and replay the original request. Two details shape it — the client uses
  `validateStatus: <500`, so a 401 is a _response_ not an exception (handled in `onResponse`); and
  refresh is **single-flight**, so a burst of five simultaneously-expired requests triggers one
  refresh, not five that race and log the user out. Unit-tested against a scripted Dio adapter:
  refresh+retry, refresh-failure clears the session and signals logout, single-flight, no
  double-retry.
- **`AuthController`** holds a sealed `AuthState` (`unknown` / `unauthenticated` /
  `authenticated`). `unknown` is load-bearing: on cold start the router shows a splash and
  redirects nowhere until the stored token is checked, so a returning user never flashes past the
  login screen. When the interceptor's refresh fails deep in a request, it raises a core-level
  session-revoked signal that flips the state to unauthenticated and the router reacts.

### Router guards — one place, not many

The GoRouter `redirect` is the single auth gate: unknown → splash, unauthenticated → login,
authenticated → the role's home (`/partner` for a delivery partner, `/home` for everyone else),
with `/partner` guarded so a customer cannot reach it. `refreshListenable` is fed by a provider
_listener_ (not a watch), so an auth change re-runs the redirect without rebuilding the router and
dropping the navigation stack.

### Offline cache — cached vs always-live is a decision, not a default

A Drift-backed `LocalCache` (JSON + TTL) with an explicit per-domain policy
(`core/database/local_cache.dart`):

- **Always live, never cached:** the wallet balance. A stale balance is worse than a spinner — a
  customer who sees ₹500 that is really ₹0 files a complaint.
- **Offline-first, cached with a TTL:** delivery/pickup history, the newspaper catalogue, and the
  signed-in profile. A delivery partner works a whole route with no signal, and the profile cache
  is what lets the app restore an authenticated session offline instead of bouncing to login.

### Design system before feature screens

Theme (Material 3 from a recycled-paper green seed), a typography scale named by role, spacing and
radii tokens, and a shared widget library — `AppButton` (with a built-in loading state, because a
button that stays tappable mid-request is how a customer double-submits), `AppCard`, `EmptyState`
(with an `.offline()` variant), `Skeleton`, and an `AsyncValueView` that renders loading/error
consistently. Built first, deliberately, so Phase 12's screens reach for these instead of each
inventing their own button padding.

> **Toolchain note.** Generated files (`*.g.dart`, `*.freezed.dart`) are not committed — run
> `dart run build_runner build` after checkout. The app is a Flutter package outside the pnpm
> workspace; its gate is `flutter analyze` (zero issues) + `flutter test`.

## Customer app screens (Phase 12)

The core customer surface, in a five-tab shell (Papers · Pickups · Wallet · Shop · Impact). Every
screen is a vertical slice — DTOs (freezed/json), a repository returning the app's `(value?,
failure?)` record, a Riverpod provider, and a screen — and every one renders loading, empty and
error states through the Phase 11 `AsyncValueView` rather than a bare spinner. That is the whole
point of building the design system first: the states come for free and look the same everywhere.

- **Newspapers & subscriptions** — browse subscribable editions (filter by pincode, which is how
  availability actually works), subscribe with a chosen frequency/billing/address, and manage a
  subscription (pause, resume, cancel-with-confirmation, change address).
- **Pickups** — schedule a pickup (address + date + time window), see history, and — the piece the
  field flow depends on — a **QR code** the delivery partner scans at the door. It is pinned
  black-on-white regardless of theme, because a dark-mode QR on a dark background does not scan.
- **Wallet** — balance, the append-only ledger, and a withdrawal request. The wallet is
  **always live, never cached** (a stale balance is worse than a spinner); withdrawals send an
  `Idempotency-Key`, and the copy is honest that the money leaves immediately and a rejection is
  refunded.
- **Impact** — the personal sustainability dashboard, and the one screen where copy is a
  correctness concern: measured figures (recycled/landfill-diverted weight) are labelled plainly,
  estimated figures (CO₂e, water, energy, trees) carry the word **"estimated"**, and the server's
  disclaimer is shown **verbatim**. No "carbon negative"/"net zero" claim appears anywhere — the
  app never asserts what the backend's methodology does not support.
- **Marketplace** — browse recycled-paper goods, add to a cart, and check out paying from the
  wallet (with the honest caveat that in-app card payment for any remaining balance is a later
  step), plus order history.

Widget tests cover the three flows the brief named — **subscribe, schedule pickup, view wallet** —
each driving the real screen against a fake repository and asserting the request that goes out.

## Delivery-partner app screens (Phase 13)

The delivery partner works the same app — Phase 11 chose one app with role-based navigation, so a
partner who verifies their number lands on a **partner shell** (Route · Pickups · History) that a
customer can never reach, guarded in the router's single redirect. The partner's day is three
screens:

- **Today's route** — the assigned run as an ordered list of stops, with a list/map toggle. The map
  is **honest**: stops carry no geocoded coordinates yet, so the toggle shows a plain note instead of
  a fake map, and the list is the working view. Each stop opens an outcome screen —
  **delivered / failed / skipped** — where failed and skipped require a reason and delivered can
  attach **photo proof** (camera → uploaded → the returned key travels with the outcome).
- **Pickups** — a **QR scanner** (with a manual-token fallback for a damaged code) reads the pickup
  the customer shows, then a **manual weighing** screen captures grams per paper type. This is the
  `WeighingDeviceReader` manual implementation surfaced in the UI: an estimate is quoted from the
  entered weights before the partner commits the completion.
- **History** — the partner's completed runs by date (delivered/failed/skipped counts). It is
  honestly framed: the backend models no partner payout, so this shows work done, **not** earnings —
  no invented rupee figure.

**Offline resilience is the point of this phase.** A partner loses signal in stairwells, basements
and dead zones all day, and a field action must never be lost. So every delivery outcome and every
completed pickup is written **first** to a durable Drift queue (`PendingActions`, schema v2), then a
sync is attempted immediately:

- **Nothing is captured over the network.** Recording an outcome or weighing paper needs no
  connectivity — only _syncing_ does — so the action is safe the instant the partner taps, online or
  not.
- **The queue is the source of truth until the server acknowledges.** A synced action is _deleted_
  (the server is then the record); a pending action is _never dropped_, only retried; a permanently
  rejected one is _parked visibly_ as "sync failed", never silently discarded.
- **Dedup by `kind:targetId`.** Re-recording the same stop before it syncs upserts to one action
  carrying the latest payload, never two racing writes.
- **Single-flight drain.** A burst of triggers — three requests finishing, connectivity flapping —
  drains the queue once, not three times, so nothing double-sends. A `connectivity_plus` listener
  flushes automatically the moment signal returns; a "Sync now" button and an app-wide "N actions
  waiting to sync" banner keep it visible and manual-overridable.
- **Conflict-as-success.** A retried action the server already applied (an `ALREADY_*` / `CONFLICT`
  response) is treated as _synced_, not failed — idempotency the client can trust.

The sync engine is split so the risky logic is **pure and unit-tested**: `decideSync(failure)`
(synced / retry / failed) is a pure function, and `SyncQueue` is a thin DAO over Drift. The brief
called the queue the highest-risk area for data-loss bugs, so it carries the phase's heaviest tests —
**11 tests** proving the invariants directly: an offline action persists and is never lost, dedup
keeps the latest, an offline→online transition drains, a `CONFLICT` resolves to synced, a permanent
validation error parks as failed (not looped), the drain is single-flight (no double-send), and the
unsynced stream reflects the queue. The partner routing itself is covered by the auth-flow widget
test (a partner lands on the partner shell, a customer cannot).

## Observability & security (Phase 14)

The "before infra/deployment" phase: make the system **debuggable** and prove it's **safe**. Full
write-up — verdicts, the one fix, load-test analysis, and the risks still needing a decision — is in
[`docs/phase-14-production-readiness.md`](docs/phase-14-production-readiness.md).

**Observability.** Everything below is **off unless configured**, so local dev and the test suite
need no collector, no Prometheus and no DSN:

- **Structured logging** (`nestjs-pino`) — every line is JSON with a `correlationId`. The mobile app
  already stamps `x-correlation-id` on each request; the API reuses it as the log `reqId`, echoes it
  on the response, and puts it in every error body, so a support ticket resolves to the exact request
  chain across app → API → logs. Secret-bearing headers and `*.otp`/`*.token`/`*.password` fields are
  `[redacted]` before anything is written.
- **Tracing** (OpenTelemetry) — `instrumentation.ts` loads before the app and traces HTTP, Express,
  ioredis (so all BullMQ↔Redis traffic), and **Prisma** (a span per DB query). BullMQ **job
  execution** is traced via a `TracedWorkerHost` base class the six workers extend — one tracing
  point, not six. Spans export over OTLP/HTTP to a collector.
- **Metrics** (Prometheus) — `GET /metrics` at a fixed, unprefixed path (like the health probes),
  default Node metrics plus an `http_request_duration_seconds` histogram (labelled by handler, not
  URL, so ids don't blow up cardinality) and `wallet_credit_total` / `pickup_completed_total`
  counters.
- **Error reporting** (Sentry) — `@sentry/node` (API), `@sentry/nextjs` (admin), `sentry_flutter`
  (mobile). Session Replay is off and PII is never attached — these surfaces show customer phones,
  addresses and balances.

**Security pass — OWASP API Top 10.** The codebase entered this phase strong (ownership from token
throughout, a global auth guard, Redis-backed throttling, an append-only ledger with row locks), so
the pass is mostly verification with **one real fix**:

- **Upload hardening** — `POST /delivery/stops/:id/photo` used to buffer the whole file into memory
  before checking size, and trusted the client-supplied `Content-Type`. Now multer aborts oversized
  uploads mid-stream (`limits`), and the type is verified by **magic bytes** (`sniffImage`) with the
  sniffed type stored — a spoofed header can neither get a non-image stored nor mislabel it.
- **Verified clean:** BOLA/IDOR (owner from token; 404 on strangers' ids), mass assignment
  (`whitelist` + `forbidNonWhitelisted`), auth/payment rate limits, **SQL injection** (every raw
  query is a parameterised Prisma tagged template; no `*Unsafe` anywhere), CORS (allowlist, never
  `*`), and secret logging (OTP logs use masked phones; header redaction added).

**Load tests** ([`apps/api/load/`](apps/api/load/README.md)) — k6 scripts for pickup completion and
wallet credit, the highest-consistency-risk paths. They run against staging (not CI); the findings
doc explains where each breaks and why — pool saturation for the fan-out paths, and the per-wallet
`SELECT … FOR UPDATE` row lock as a **deliberate** ceiling on same-wallet write rate (the lost-update
guarantee showing up as latency, not a bug).

New tests this phase: unit specs for the magic-byte sniffer, the metrics service, and the log
correlation/redaction config, alongside the existing suites (all green).

## Deployment (Phase 15)

Everything needed to ship the platform, in [`infra/`](infra/) and [`.github/workflows/`](.github/workflows/).
The [runbook](docs/runbook.md) covers day-2 operations.

**Kubernetes (Kustomize, base + staging/production overlays):**

- **API** Deployment (HTTP; job scheduling off), **worker** Deployment (the sole cron scheduler,
  dedicated job capacity), **Redis** StatefulSet, and the **admin** Deployment — each with
  liveness/readiness probes, resource requests/limits, a read-only root FS and dropped capabilities.
- **HPAs** (API + worker) and **PodDisruptionBudgets**; an **Ingress** that routes only `/api`
  externally so `/metrics` and `/health` stay in-cluster.
- The **API and worker run the same image**, split purely by config — so the nightly jobs schedule
  exactly once instead of on every replica (the old multi-replica-cron issue, now fixed).

**CI/CD ([`deploy.yml`](.github/workflows/deploy.yml)):** on merge to `main`, build immutable images
(tagged by commit sha) → push to GHCR → **auto-deploy staging** → **pause at the `production`
approval gate** → deploy production. `prisma migrate deploy` runs as a **separate Job that must
succeed before any rollout** — a bad migration stops the release before new code serves traffic, and
`migrate deploy` only applies reviewed migration files (never generates or resets).

**Mobile ([`mobile-release.yml`](.github/workflows/mobile-release.yml)):** a `mobile-v*` tag builds a
signed **AAB** and **IPA**; a **manual approval gate** then promotes them (via Fastlane) to the Play
**internal track** and **TestFlight** — as drafts, never straight to production.

**Secrets never touch the repo:** `*.example.yaml` manifests document the _keys_; real values come
from the **External Secrets Operator** reading a cloud secret manager, and the env schema fails fast
in production without them. CI/CD secrets live in GitHub.

Known follow-ups (in the runbook): worker autoscaling should key off queue depth (KEDA) not CPU;
managed Postgres/Redis are preferred over self-hosted; real SMS + S3 storage providers are the
remaining code prerequisite before the API boots in `NODE_ENV=production`.

## Production readiness

**This is a working, well-tested pilot build — not a production deployment.** The core loop
(subscribe → deliver → pick up → weigh → pay → batch → recycle → trace → sell) runs end to end,
with 359 unit and 171 e2e tests against real Postgres and Redis on the API, plus an ops console
(`apps/admin`) with component tests for the critical support workflows. But the build plan puts
real production hardening in Phases 14–15 (observability, OWASP pass, load testing, k8s, secrets,
CI/CD to a cluster), and this pass does **not** short-circuit those. What that means concretely:

**Ready:**

- The money path is defended in depth: an append-only ledger enforced by a DB trigger, row
  locks against lost updates, a monotonic sequence so reconciliation is trustworthy, and
  three independent guards against double-crediting a pickup.
- Every destructive/financial operation is transactional and idempotent where it needs to be.
- Nightly reconciliation replays every wallet's ledger and alerts on any mismatch.
- Multi-replica correctness: rate limits, the throttler, and now WebSocket events are all
  Redis-backed, so nothing silently breaks when you scale past one pod.
- The env schema refuses to boot in production with dev-only providers (console SMS, local
  disk storage) or Swagger enabled.
- **Observability is built in** (Phase 14): structured JSON logs with a correlation id threaded
  app→API→logs and secrets redacted, OpenTelemetry traces (HTTP/DB/BullMQ), a Prometheus
  `/metrics` endpoint, and Sentry across all three apps — inert until configured.
- **Security-audited** (Phase 14): a full OWASP API Top 10 pass (see
  [`docs/phase-14-production-readiness.md`](docs/phase-14-production-readiness.md)) came back clean
  but for the upload hardening it fixed; SQLi is impossible (all raw queries are parameterised
  tagged templates), IDOR is closed (ownership from token everywhere), auth/payment paths are
  rate-limited and idempotent.
- **Deployable** (Phase 15): Kustomize manifests (API, worker, Redis, admin) with probes, limits,
  HPAs and PDBs; CI/CD that builds immutable images, auto-deploys staging, gates production behind a
  manual approval, and runs migrations as a separate reviewed step; a Flutter build+promote pipeline;
  External-Secrets-based secret management; and a [runbook](docs/runbook.md). The nightly jobs now
  run on a single worker Deployment, not every replica.

**NOT ready — do this before real users or real money:**

- **The deploy pipeline needs a cluster + secrets wired to it.** The manifests and workflows exist,
  but they need a real Kubernetes cluster, DNS, TLS (cert-manager), the GitHub Environments/secrets,
  and the observability stack (collector + Prometheus + Sentry DSNs) actually provisioned. See the
  setup roadmap. **k6 load numbers are still pending** a staging run to set HPA thresholds from data.
- **A real SMS provider and real S3-compatible storage must be implemented** — the schema ships only
  dev stubs (`console` SMS, `local` storage) and **refuses them in production**, so the API will not
  boot in prod until these exist. Payment (`razorpay`) and push (`fcm`) providers already exist and
  just need credentials.
- **RBI PPI / DPDP / gig-worker classification** are unresolved legal questions (see below and
  the Phase 16 checklist). None are engineering problems; all can block a public launch.

Treat this as ready for a **controlled pilot** (one apartment complex, one recycler, staff
watching) — not an open launch.

## Known gaps (Phase 5)

- **Route/load optimisation is not built** — batching groups by zone and paper type and stops
  there. Documented future enhancement, not an oversight.
- **Capacity limits are advisory** — dispatching over a mill's stated daily capacity warns but
  does not refuse, because a mill briefly over its ceiling will usually still take the load.
- **A pickup in a zone with no delivery round that day now gets a pickup-only run** (fixed this
  phase — a recycle-only customer was previously stranded). It costs a trip the delivery round
  would otherwise subsidise; that trade is logged.

## Known gaps (Phase 4)

- **No real weighing hardware.** `WeighingDeviceReader` has a manual-entry implementation
  that validates the numbers (whole grams, positive, plausible — 200 kg of newspaper is a
  fat finger, not a pickup). A Bluetooth scale is a new class and one line of wiring; the
  validation stays, because a flaky BLE link reports nonsense too.
- **No auto-generated pickups from a subscription cadence.** Customers request each pickup
  explicitly. The plumbing (the nightly job, zone routing) is there to add it.
- **Idempotency keys are never garbage-collected.** The table grows forever. A retention
  job (delete keys older than ~24h) belongs in Phase 14.
- **No reconciliation job.** `/reconcile` exists per-wallet and on demand; nothing sweeps
  every wallet nightly and alerts on a mismatch. That should exist before real money.

## Known gaps (Phase 3)

- **Route optimisation is not built.** Stops are sequenced in insertion order. Real
  routing needs geocoded addresses (we don't collect them yet) and is premature before
  real partners have walked real routes.
- **Zones are pincode lists, not polygons.** Deliberate: an ops person can edit a pincode
  list, and it joins directly against the pincode already on every address. Polygons need
  GIS tooling and a point-in-polygon query on the planner's hot path, to solve a
  sub-pincode granularity problem we don't have.
- **Socket.io has no Redis adapter yet**, so with more than one API replica an event only
  reaches admins connected to the _same pod_. Redis is already a dependency; this is a
  wiring change in Phase 15, not a redesign.
- **A reassigned run is all-or-nothing** — refused once any stop is actioned. Splitting a
  half-done run is a different operation and needs designing, not falling into.
- **Local disk storage is dev-only.** The API refuses to boot with
  `NODE_ENV=production` and `STORAGE_PROVIDER=local`.

## Known gaps (Phase 2)

- **Nothing is invoiced or charged.** `charge-preview` and `quote` compute the amount;
  no money moves and no invoice row is written. That is Phase 4, alongside the wallet.
- **Pause and cancel take effect from today only** — you cannot schedule "pause from next
  Monday". Backdating is refused outright (`BACKDATED_CHANGE`), because it would rewrite
  an invoice that has already been issued.
- **`QUARTERLY` billing is implemented and tested, but no product uses it yet.**
- **Delivery scheduling does not exist.** A subscription says which issues are billable;
  nothing yet turns that into a run sheet. Phase 3.

## Known gaps (Phase 1)

- **No real SMS provider.** Only `console`. Production boot is blocked until one exists.
- **No admin endpoints to change a user's role or suspend them.** Both are DB-level
  operations today. They need an audit trail, which arrives with the `AuditLog` model
  in Phase 9.
- **Access tokens cannot be revoked before they expire** (15 minutes). Suspension is
  enforced by the per-request `isActive` check instead; a role _downgrade_ likewise
  takes effect immediately because the guard reads the role from the database, not the
  token.
- **Apartment and Business exist as tables only** — no endpoints, no membership. Phase 7.

## Known gaps (Phase 0)

- **`freezed` is pinned to a prerelease** (`3.2.6-dev.1`). The Dart ecosystem is
  mid-migration from analyzer 12 to 13: every `freezed` 3.2.x needs analyzer ^12 while
  `drift_dev` ≥2.34.1+1 needs ^13, and pub cannot satisfy both. Freezed is a
  build-time code generator and ships in no APK or IPA, so the blast radius is the
  build, not the product. Revisit when the ecosystem converges. Same root cause keeps
  `riverpod_lint`/`custom_lint` out of the project — see `apps/mobile/pubspec.yaml`.
- **`infra/k8s` is shape, not a deployment — and it is UNVERIFIED.** The YAML parses,
  but `kustomize build` has never been run against it and it has never been applied to
  a cluster (no `kubectl`/`kustomize` on the machine that scaffolded this). Treat it as
  a starting point to be validated, not as known-good. Phase 15 owns it.
- **`infra/docker/*.Dockerfile` are UNBUILT.** Written but never executed — no Docker
  daemon was available. `infra/docker/docker-compose.yml` likewise was never run by
  `docker compose`; the Postgres and Redis services it defines were verified by running
  the same images directly under Podman, so the images and credentials are right, but
  the compose file itself has not been executed. Build and run both once before relying
  on them.
- **No auth.** Every endpoint is open. Phase 1.
