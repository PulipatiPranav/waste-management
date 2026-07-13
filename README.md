# Circular Paper Economy

Newspaper subscription → scheduled recyclable paper pickup → digital weighing →
cashback → recycling partner handoff → sustainability reporting → marketplace.

> **Status: Phase 0 — scaffolding only.** No business features are implemented. The
> repo builds, lints, typechecks and tests end to end; every module below is a
> skeleton with a reference implementation to copy, not a feature.

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

# 4. Apply migrations (no-op today — Phase 0 declares no models)
pnpm --filter @cpe/api exec prisma migrate deploy
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
