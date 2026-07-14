# Circular Paper Economy

Newspaper subscription → scheduled recyclable paper pickup → digital weighing →
cashback → recycling partner handoff → sustainability reporting → marketplace.

> **Status: Phase 3 — delivery partners & daily runs.** Forward newspaper logistics: a
> nightly planner that turns subscriptions into run sheets, partner delivery recording
> with photo proof, and a live ops feed. No pickup, recycling or wallet yet.

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
