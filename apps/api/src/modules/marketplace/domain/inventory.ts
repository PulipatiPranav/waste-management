import { ConflictError, InvariantViolationError } from '@/shared/domain/errors/domain.error';

/**
 * Raised when an order line cannot be fulfilled because stock ran out between checkout and
 * confirmation — the losing side of a concurrent-order race. A ConflictError (409), not a
 * 500: two customers wanting the last unit is an expected outcome, not a bug.
 */
export class OutOfStockError extends ConflictError {
  override readonly code = 'OUT_OF_STOCK';

  constructor(
    readonly sku: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(`Only ${available} of ${sku} left; ${requested} requested.`);
  }
}

/**
 * The stock that WOULD remain after taking `quantity` units — or throws if that would go
 * negative.
 *
 * This is the pure statement of the oversell rule. The ACTUAL guard against two orders
 * taking the same last unit is a conditional `UPDATE ... WHERE stock >= quantity` under the
 * database's row lock (a read-here-decrement-there in application code would lose the race);
 * this function exists to make the arithmetic testable and to name the invariant the DB
 * `stock >= 0` CHECK constraint backs up.
 */
export function remainingAfterFulfilment(available: number, quantity: number, sku: string): number {
  if (!Number.isInteger(available) || available < 0) {
    throw new InvariantViolationError(`available stock must be a non-negative integer for ${sku}`);
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvariantViolationError(`quantity must be a positive integer for ${sku}`);
  }

  const remaining = available - quantity;
  if (remaining < 0) {
    throw new OutOfStockError(sku, quantity, available);
  }
  return remaining;
}
