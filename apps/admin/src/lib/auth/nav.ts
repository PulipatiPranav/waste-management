import type { Role } from '../api/types';

export interface NavItem {
  href: string;
  label: string;
  /** Roles allowed to see and reach this section — mirrors the backend guard on its endpoints. */
  roles: Role[];
}

/** Every role that has a password and can sign into this console at all. */
const STAFF: Role[] = ['OPS_STAFF', 'SUPER_ADMIN'];

/**
 * The console's navigation, each item gated to exactly the roles the backend permits on the
 * endpoints behind it. Filtering the nav is a convenience, not the control — the API enforces
 * the same roles on every call — but a support agent should never see a link that will only 403.
 */
export const NAV: NavItem[] = [
  { href: '/', label: 'Overview', roles: STAFF },
  { href: '/delivery', label: 'Delivery runs', roles: STAFF },
  { href: '/wallet', label: 'Wallet oversight', roles: STAFF },
  { href: '/recycling', label: 'Recycling & custody', roles: STAFF },
  { href: '/orgs', label: 'Org accounts', roles: STAFF },
  { href: '/marketplace', label: 'Marketplace orders', roles: STAFF },
  { href: '/sustainability', label: 'Sustainability', roles: STAFF },
  // The audit trail is itself sensitive; SUPER_ADMIN and OPS_STAFF only, matching its controller.
  { href: '/audit', label: 'Audit log', roles: STAFF },
];

export function visibleNav(role: Role | undefined): NavItem[] {
  if (role === undefined) return [];
  return NAV.filter((item) => item.roles.includes(role));
}

export function canAccess(role: Role | undefined, href: string): boolean {
  if (role === undefined) return false;
  const item = NAV.find((nav) => nav.href === href);
  return item?.roles.includes(role) ?? false;
}
