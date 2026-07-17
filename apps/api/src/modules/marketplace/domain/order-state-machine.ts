import { ConflictError } from '@/shared/domain/errors/domain.error';

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ACTIONS = ['CONFIRM', 'FAIL', 'SHIP', 'DELIVER', 'CANCEL'] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export class InvalidOrderTransitionError extends ConflictError {
  override readonly code = 'INVALID_ORDER_TRANSITION';

  constructor(from: OrderStatus, action: OrderAction) {
    super(`Cannot ${action.toLowerCase()} an order that is ${from}.`);
  }
}

/**
 * The order lifecycle.
 *
 *   PENDING_PAYMENT --confirm--> CONFIRMED --ship--> SHIPPED --deliver--> DELIVERED
 *                 |                      \--cancel--> CANCELLED (refund wallet + gateway)
 *                 |--fail----> FAILED   (confirmation could not complete; nothing left charged)
 *                 \--cancel--> CANCELLED (buyer abandoned before paying; nothing to refund)
 *
 * The transition that matters is CONFIRM: it is the only one that moves stock and money,
 * and it is guarded in TWO independent ways so a replay cannot fire it twice — a conditional
 * `UPDATE ... WHERE status = 'PENDING_PAYMENT'` in the repository (so a second confirmation
 * finds nothing to update) and the partial-unique wallet-debit index at the database. This
 * table is the third: it refuses to describe confirming an already-confirmed order at all.
 *
 * FAILED is terminal and honest — an order that could not be fulfilled says so, rather than
 * being quietly retried forever. It is reached only from PENDING_PAYMENT, because once an
 * order is CONFIRMED its stock and money have moved and "undoing" it is a CANCEL (which
 * refunds), never a silent FAIL.
 */
const TRANSITIONS: Readonly<
  Record<OrderStatus, Readonly<Record<OrderAction, OrderStatus | null>>>
> = {
  PENDING_PAYMENT: {
    CONFIRM: 'CONFIRMED',
    FAIL: 'FAILED',
    CANCEL: 'CANCELLED',
    SHIP: null,
    DELIVER: null,
  },
  CONFIRMED: {
    CONFIRM: null,
    FAIL: null,
    SHIP: 'SHIPPED',
    // A confirmed-but-unshipped order can still be cancelled; the money is refunded.
    CANCEL: 'CANCELLED',
    DELIVER: null,
  },
  SHIPPED: {
    CONFIRM: null,
    FAIL: null,
    SHIP: null,
    DELIVER: 'DELIVERED',
    // Once it is on a truck it cannot be cancelled in-system — that is a returns problem.
    CANCEL: null,
  },
  DELIVERED: { CONFIRM: null, FAIL: null, SHIP: null, DELIVER: null, CANCEL: null },
  CANCELLED: { CONFIRM: null, FAIL: null, SHIP: null, DELIVER: null, CANCEL: null },
  FAILED: { CONFIRM: null, FAIL: null, SHIP: null, DELIVER: null, CANCEL: null },
};

export function canTransitionOrder(from: OrderStatus, action: OrderAction): boolean {
  return TRANSITIONS[from][action] !== null;
}

/** @throws {InvalidOrderTransitionError} */
export function applyOrderTransition(from: OrderStatus, action: OrderAction): OrderStatus {
  const next = TRANSITIONS[from][action];

  if (next === null) {
    throw new InvalidOrderTransitionError(from, action);
  }

  return next;
}
