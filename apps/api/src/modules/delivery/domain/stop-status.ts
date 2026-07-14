import { ConflictError, InvariantViolationError } from '@/shared/domain/errors/domain.error';

export const STOP_STATUSES = ['PENDING', 'DELIVERED', 'FAILED', 'SKIPPED'] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

/** The three outcomes a partner can record. PENDING is not one of them — you cannot un-deliver. */
export const STOP_OUTCOMES = ['DELIVERED', 'FAILED', 'SKIPPED'] as const;
export type StopOutcome = (typeof STOP_OUTCOMES)[number];

export class InvalidStopTransitionError extends ConflictError {
  override readonly code = 'INVALID_STOP_TRANSITION';

  constructor(from: StopStatus, to: StopStatus) {
    super(`This delivery is already ${from} and cannot be changed to ${to}.`);
  }
}

export class StopReasonRequiredError extends InvariantViolationError {
  override readonly code = 'STOP_REASON_REQUIRED';

  constructor(outcome: StopOutcome) {
    super(`A reason is required when marking a delivery ${outcome}.`);
  }
}

export class StopReasonNotAllowedError extends InvariantViolationError {
  override readonly code = 'STOP_REASON_NOT_ALLOWED';

  constructor() {
    super('A reason cannot be given for a successful delivery.');
  }
}

/**
 * A stop's outcome is recorded exactly once.
 *
 * PENDING is the only non-terminal state: once a partner says DELIVERED, FAILED or
 * SKIPPED, that is the record. Allowing DELIVERED -> FAILED would let a partner (or a
 * replayed request on a flaky mobile network — see Phase 4's idempotency work) rewrite
 * history, and by Phase 4 that history is what decides whether a customer gets billed
 * for a paper. Corrections are an ops action with an audit trail, not a partner one.
 */
export function assertCanRecordOutcome(current: StopStatus, next: StopOutcome): void {
  if (current !== 'PENDING') {
    throw new InvalidStopTransitionError(current, next);
  }
}

/**
 * FAILED and SKIPPED must say why; DELIVERED must not.
 *
 * Mirrors the `delivery_stops_reason_matches_status` check constraint, because a rule
 * enforced only in the database surfaces as a 500, and one enforced only in the
 * application is one bad write path away from being untrue.
 */
export function assertReasonMatchesOutcome(
  outcome: StopOutcome,
  reason: string | null,
): asserts reason is string | null {
  const trimmed = reason?.trim() ?? '';

  if (outcome === 'DELIVERED' && trimmed.length > 0) {
    throw new StopReasonNotAllowedError();
  }

  if (outcome !== 'DELIVERED' && trimmed.length === 0) {
    throw new StopReasonRequiredError(outcome);
  }
}
