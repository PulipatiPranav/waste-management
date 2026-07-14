import { InvalidTransitionError } from './errors/subscription.errors';

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_ACTIONS = ['PAUSE', 'RESUME', 'CANCEL', 'CHANGE_ADDRESS'] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

/**
 * The complete, exhaustive transition table.
 *
 * ONE table, and every lifecycle question is answered by reading it. The alternative —
 * an `if (status !== 'CANCELLED')` here, a `if (status === 'PAUSED')` there — is how a
 * subscription ends up resumable after cancellation: not because anyone decided that,
 * but because one of the five checks scattered across the codebase forgot a case.
 *
 * Note what is deliberately ABSENT:
 *   - CANCELLED has no outgoing transitions at all. It is terminal. Reviving a
 *     cancelled subscription must be a new subscription, because the old one's final
 *     invoice has already been computed from its cancellation date.
 *   - PAUSE from PAUSED is not idempotent-by-omission, it is an error. Silently
 *     accepting it would open a second pause window (or, worse, be rejected by the
 *     one-open-pause unique index at 3am) and double-credit the customer.
 */
const TRANSITIONS: Readonly<
  Record<SubscriptionStatus, Readonly<Record<SubscriptionAction, SubscriptionStatus | null>>>
> = {
  ACTIVE: {
    PAUSE: 'PAUSED',
    RESUME: null, // already running
    CANCEL: 'CANCELLED',
    CHANGE_ADDRESS: 'ACTIVE',
  },
  PAUSED: {
    PAUSE: null, // already paused
    RESUME: 'ACTIVE',
    CANCEL: 'CANCELLED',
    // Allowed while paused on purpose: a customer who is away and moving house should
    // be able to fix the address before delivery restarts, not after a wrong drop.
    CHANGE_ADDRESS: 'PAUSED',
  },
  CANCELLED: {
    PAUSE: null,
    RESUME: null,
    CANCEL: null,
    CHANGE_ADDRESS: null,
  },
};

export function canTransition(from: SubscriptionStatus, action: SubscriptionAction): boolean {
  return TRANSITIONS[from][action] !== null;
}

/**
 * The resulting status, or a domain error naming both the state and the action.
 *
 * @throws {InvalidTransitionError}
 */
export function applyTransition(
  from: SubscriptionStatus,
  action: SubscriptionAction,
): SubscriptionStatus {
  const next = TRANSITIONS[from][action];

  if (next === null) {
    throw new InvalidTransitionError(from, action);
  }

  return next;
}
