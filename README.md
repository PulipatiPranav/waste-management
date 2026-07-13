# Circular Paper Economy

Newspaper subscription → scheduled recyclable paper pickup → digital weighing →
cashback → recycling partner handoff → sustainability reporting → marketplace.

> **Status: Phase 1 — auth, users, roles.** Phone-OTP login, JWT sessions with
> refresh-token rotation, role guards, and user/address CRUD. No subscription,
> delivery, pickup or wallet features yet.

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
