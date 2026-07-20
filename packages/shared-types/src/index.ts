/**
 * Contract types shared between the NestJS API (`@apps/api`) and the Next.js
 * admin dashboard (`@apps/admin`).
 *
 * Scope discipline: this package holds *transport* contracts only — the shapes
 * that cross the HTTP boundary. Domain entities and business rules live in the
 * API's domain layer and must not leak here.
 *
 * `src/generated/api.ts` is produced from the API's OpenAPI spec
 * (`@nestjs/swagger` -> openapi-typescript) by `pnpm --filter @cpe/api gen:types`,
 * and is the single source of truth for request/response shapes. It is committed so
 * the admin builds without needing the API running; regenerate it whenever a
 * controller or DTO changes, and any drift becomes a TypeScript error in the admin
 * build rather than a runtime surprise. Everything in `src/` outside `generated/`
 * stays hand-written.
 */

export * from './http/envelope.js';
export * from './http/pagination.js';

// The generated OpenAPI surface: `paths` (every route), `components` (every schema),
// `operations` (every endpoint's request/response). Plus a `Schemas` shorthand so a
// consumer can write `Schemas['WalletDto']` instead of the full index chain.
export type { components, operations, paths } from './generated/api.js';
export type { Schemas } from './schemas.js';
