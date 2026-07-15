import { ConflictError } from '@/shared/domain/errors/domain.error';

export const BATCH_STATUSES = ['OPEN', 'READY', 'DISPATCHED', 'CONFIRMED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_ACTIONS = ['ADD_ITEM', 'CLOSE', 'DISPATCH', 'CONFIRM'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

export class InvalidBatchTransitionError extends ConflictError {
  override readonly code = 'INVALID_BATCH_TRANSITION';

  constructor(from: BatchStatus, action: BatchAction) {
    super(`Cannot ${action.toLowerCase().replace('_', ' ')} a batch that is ${from}.`);
  }
}

/**
 * OPEN -> READY -> DISPATCHED -> CONFIRMED. One direction, no way back.
 *
 * The chain of custody is a chain precisely because it does not have loops. An item cannot
 * be added to a batch that is already on a lorry; a batch cannot be dispatched twice; and a
 * confirmed batch is closed forever, because the mill's weighbridge reading is the last
 * word and Phase 6's tonnage claims are computed from it. Every one of those is a cell in
 * this table, not an `if` in a service.
 */
const TRANSITIONS: Readonly<
  Record<BatchStatus, Readonly<Record<BatchAction, BatchStatus | null>>>
> = {
  OPEN: {
    ADD_ITEM: 'OPEN',
    CLOSE: 'READY',
    // Cannot dispatch without closing: the closing step is what fixes the collected
    // weight the weighbridge will be compared against. Skip it and the batch could still
    // be growing while the truck is on the road.
    DISPATCH: null,
    CONFIRM: null,
  },
  READY: {
    // Closed means closed. An item arriving after the paperwork is written is an item the
    // mill will weigh but the manifest does not mention.
    ADD_ITEM: null,
    CLOSE: null,
    DISPATCH: 'DISPATCHED',
    CONFIRM: null,
  },
  DISPATCHED: {
    ADD_ITEM: null,
    CLOSE: null,
    // One dispatch per batch, also enforced by a unique index on BatchDispatch.batchId.
    DISPATCH: null,
    CONFIRM: 'CONFIRMED',
  },
  CONFIRMED: {
    ADD_ITEM: null,
    CLOSE: null,
    DISPATCH: null,
    // Terminal. Re-confirming would mean a second weighbridge reading overwriting the
    // first — and the discrepancy between them is evidence, not a draft.
    CONFIRM: null,
  },
};

export function canTransition(from: BatchStatus, action: BatchAction): boolean {
  return TRANSITIONS[from][action] !== null;
}

/** @throws {InvalidBatchTransitionError} */
export function applyBatchTransition(from: BatchStatus, action: BatchAction): BatchStatus {
  const next = TRANSITIONS[from][action];

  if (next === null) {
    throw new InvalidBatchTransitionError(from, action);
  }

  return next;
}
