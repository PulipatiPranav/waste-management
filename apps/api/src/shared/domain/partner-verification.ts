import { ConflictError } from './errors/domain.error';

/**
 * The one verification lifecycle shared by every kind of external partner.
 *
 * Recycling partners (Phase 5) and marketplace sellers (Phase 8) are different businesses
 * that receive or supply different things, but the question "is this partner allowed to
 * transact yet?" has the same three answers for both, and a platform that grows a bespoke
 * verification flow per partner type is a platform where one of them is quietly wrong — an
 * unverified seller whose goods are somehow buyable, a suspended recycler that still gets
 * dispatches. So the states, and the rules for moving between them, live here, once.
 *
 *   PENDING --verify--> VERIFIED --suspend--> SUSPENDED
 *          \--suspend-> SUSPENDED --reinstate-> VERIFIED
 *
 * A partner starts PENDING: it is never verified by the mere act of being typed into a
 * form. Only VERIFIED partners transact. SUSPENDED is terminal-ish but reversible by an
 * explicit reinstatement — an offboarded partner keeps all its history and simply
 * transacts nothing new.
 */
export const PARTNER_STATUSES = ['PENDING', 'VERIFIED', 'SUSPENDED'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_VERIFICATION_ACTIONS = ['VERIFY', 'SUSPEND', 'REINSTATE'] as const;
export type PartnerVerificationAction = (typeof PARTNER_VERIFICATION_ACTIONS)[number];

export class InvalidPartnerTransitionError extends ConflictError {
  override readonly code = 'INVALID_PARTNER_TRANSITION';

  constructor(from: PartnerStatus, action: PartnerVerificationAction) {
    super(`Cannot ${action.toLowerCase()} a partner that is ${from}.`);
  }
}

const TRANSITIONS: Readonly<
  Record<PartnerStatus, Readonly<Record<PartnerVerificationAction, PartnerStatus | null>>>
> = {
  PENDING: {
    VERIFY: 'VERIFIED',
    SUSPEND: 'SUSPENDED',
    // Nothing to reinstate — it was never verified.
    REINSTATE: null,
  },
  VERIFIED: {
    // Already verified; re-verifying is a no-op that would wrongly re-stamp verifiedAt.
    VERIFY: null,
    SUSPEND: 'SUSPENDED',
    REINSTATE: null,
  },
  SUSPENDED: {
    VERIFY: null,
    SUSPEND: null,
    REINSTATE: 'VERIFIED',
  },
};

export function canTransitionPartner(
  from: PartnerStatus,
  action: PartnerVerificationAction,
): boolean {
  return TRANSITIONS[from][action] !== null;
}

/** Whether a partner in this state is allowed to transact (sell, receive dispatches, …). */
export function isPartnerActive(status: PartnerStatus): boolean {
  return status === 'VERIFIED';
}

/** @throws {InvalidPartnerTransitionError} */
export function applyPartnerTransition(
  from: PartnerStatus,
  action: PartnerVerificationAction,
): PartnerStatus {
  const next = TRANSITIONS[from][action];

  if (next === null) {
    throw new InvalidPartnerTransitionError(from, action);
  }

  return next;
}
