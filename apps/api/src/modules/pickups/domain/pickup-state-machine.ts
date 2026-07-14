import { ConflictError } from '@/shared/domain/errors/domain.error';

export const PICKUP_STATUSES = ['REQUESTED', 'ASSIGNED', 'COMPLETED', 'CANCELLED'] as const;
export type PickupStatus = (typeof PICKUP_STATUSES)[number];

export const PICKUP_ACTIONS = ['ASSIGN', 'COMPLETE', 'CANCEL'] as const;
export type PickupAction = (typeof PICKUP_ACTIONS)[number];

export class InvalidPickupTransitionError extends ConflictError {
  override readonly code = 'INVALID_PICKUP_TRANSITION';

  constructor(
    readonly from: PickupStatus,
    readonly action: PickupAction,
  ) {
    super(`Cannot ${action.toLowerCase()} a pickup that is ${from}.`);
  }
}

/**
 * The complete transition table.
 *
 * COMPLETED is terminal, and that is the single most important cell in this table: a
 * completed pickup has credited a customer's wallet, and the ledger is append-only.
 * "Re-completing" it could only ever mean paying twice.
 *
 * A pickup can be CANCELLED right up until it is completed — including after assignment,
 * because a customer can cancel while the partner is on their way, and a partner can find
 * nobody home.
 */
const TRANSITIONS: Readonly<
  Record<PickupStatus, Readonly<Record<PickupAction, PickupStatus | null>>>
> = {
  REQUESTED: {
    ASSIGN: 'ASSIGNED',
    // Cannot complete an unassigned pickup: nobody has been authorised to weigh it, and
    // the scan step is what proves a partner was actually at the door.
    COMPLETE: null,
    CANCEL: 'CANCELLED',
  },
  ASSIGNED: {
    ASSIGN: null,
    COMPLETE: 'COMPLETED',
    CANCEL: 'CANCELLED',
  },
  COMPLETED: {
    ASSIGN: null,
    COMPLETE: null, // Terminal. The wallet has already been credited.
    CANCEL: null, // Cancelling a paid pickup would mean clawing back cashback.
  },
  CANCELLED: {
    ASSIGN: null,
    COMPLETE: null,
    CANCEL: null,
  },
};

export function canTransition(from: PickupStatus, action: PickupAction): boolean {
  return TRANSITIONS[from][action] !== null;
}

/** @throws {InvalidPickupTransitionError} */
export function applyPickupTransition(from: PickupStatus, action: PickupAction): PickupStatus {
  const next = TRANSITIONS[from][action];

  if (next === null) {
    throw new InvalidPickupTransitionError(from, action);
  }

  return next;
}
