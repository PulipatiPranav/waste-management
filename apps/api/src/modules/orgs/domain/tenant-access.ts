import { ForbiddenError } from '@/shared/domain/errors/domain.error';

export type OrgKind = 'APARTMENT' | 'BUSINESS';
export type OrgRole = 'ADMIN' | 'MEMBER';

/** One of a user's org memberships, as the access rules see it. */
export interface Membership {
  orgKind: OrgKind;
  orgId: string;
  orgRole: OrgRole;
}

/** Names both what was attempted and on which org, so a support ticket is answerable. */
export class OrgAccessDeniedError extends ForbiddenError {
  override readonly code = 'ORG_ACCESS_DENIED';

  constructor(orgKind: OrgKind, orgId: string) {
    super(`You do not administer this ${orgKind.toLowerCase()}.`);
    void orgId; // captured for logs by the caller; not leaked in the message
  }
}

/**
 * The tenant-isolation core. Pure, exhaustively testable, and the single place the question
 * "may THIS user act on THIS org?" is answered.
 *
 * This is the most important code in the phase. Tenant isolation enforced only in the UI, or
 * re-derived ad-hoc in each controller, is one forgotten check away from one business reading
 * another's ESG report and member list. So every org operation resolves the caller's
 * memberships and passes them through here, and the answer is a scoping fact the repository
 * query is then built around — not a filter applied after the data is already loaded.
 */

/** Is the user the ADMIN of this specific org? Admin rights are per-org, never global. */
export function isOrgAdmin(
  memberships: readonly Membership[],
  orgKind: OrgKind,
  orgId: string,
): boolean {
  return memberships.some(
    (m) => m.orgKind === orgKind && m.orgId === orgId && m.orgRole === 'ADMIN',
  );
}

/** Is the user a member (of any role) of this specific org? */
export function isOrgMember(
  memberships: readonly Membership[],
  orgKind: OrgKind,
  orgId: string,
): boolean {
  return memberships.some((m) => m.orgKind === orgKind && m.orgId === orgId);
}

/**
 * Asserts the user administers this org, or throws.
 *
 * @throws {OrgAccessDeniedError}
 */
export function assertOrgAdmin(
  memberships: readonly Membership[],
  orgKind: OrgKind,
  orgId: string,
): void {
  if (!isOrgAdmin(memberships, orgKind, orgId)) {
    throw new OrgAccessDeniedError(orgKind, orgId);
  }
}

/**
 * The org ids a user administers, of a given kind.
 *
 * Used to SCOPE list queries: "show me my contracts" becomes "show contracts WHERE orgId IN
 * (the ids this user administers)". Scoping the query by this set is what makes isolation a
 * property of the data access, not of a forgotten post-filter.
 */
export function administeredOrgIds(memberships: readonly Membership[], orgKind: OrgKind): string[] {
  return memberships
    .filter((m) => m.orgKind === orgKind && m.orgRole === 'ADMIN')
    .map((m) => m.orgId);
}
