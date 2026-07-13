/**
 * Contract types shared between the NestJS API (`@apps/api`) and the Next.js
 * admin dashboard (`@apps/admin`).
 *
 * Scope discipline: this package holds *transport* contracts only — the shapes
 * that cross the HTTP boundary. Domain entities and business rules live in the
 * API's domain layer and must not leak here.
 *
 * From a later phase, `src/generated/` will be produced from the API's OpenAPI
 * spec (`@nestjs/swagger` -> openapi-typescript) and re-exported from this file.
 * Everything in `src/` outside `generated/` stays hand-written.
 */

export * from './http/envelope.js';
export * from './http/pagination.js';
