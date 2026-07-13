/**
 * Roles, mirrored from the Prisma enum.
 *
 * Declared here rather than imported from `@prisma/client` because the domain layer
 * must not depend on the ORM — ESLint enforces that. The e2e suite asserts the two
 * definitions agree, so a role added to the schema but not here fails CI rather than
 * silently becoming un-guardable.
 */
export const ROLES = [
  'CUSTOMER',
  'APARTMENT_ADMIN',
  'BUSINESS_ADMIN',
  'DELIVERY_PARTNER',
  'RECYCLING_PARTNER_ADMIN',
  'OPS_STAFF',
  'SUPER_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Roles that authenticate with an email + password rather than an OTP. */
export const STAFF_ROLES: readonly Role[] = ['OPS_STAFF', 'SUPER_ADMIN'];
