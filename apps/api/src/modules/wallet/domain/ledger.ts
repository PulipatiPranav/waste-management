import { InvariantViolationError } from '@/shared/domain/errors/domain.error';

export const WALLET_TXN_TYPES = [
  'PICKUP_CASHBACK',
  'WITHDRAWAL_DEBIT',
  'WITHDRAWAL_REVERSAL',
  'ADJUSTMENT',
  // Phase 8 marketplace: the wallet portion of an order, and its reversal on cancel/refund.
  'ORDER_PAYMENT',
  'ORDER_REFUND',
] as const;

export type WalletTxnType = (typeof WALLET_TXN_TYPES)[number];
export type WalletTxnDirection = 'CREDIT' | 'DEBIT';

export class InsufficientBalanceError extends InvariantViolationError {
  override readonly code = 'INSUFFICIENT_BALANCE';

  constructor(
    readonly balancePaise: bigint,
    readonly requestedPaise: bigint,
  ) {
    super('That is more than your wallet balance.');
  }
}

export interface LedgerEntry {
  type: WalletTxnType;
  direction: WalletTxnDirection;
  amountPaise: bigint;
  balanceAfterPaise: bigint;
}

/**
 * Applies one entry to a balance.
 *
 * A pure function, so the arithmetic that decides what a customer is owed can be tested
 * exhaustively without a database, a transaction or a clock. The repository is
 * responsible for doing this *atomically* under a row lock; this is responsible for
 * doing it *correctly*.
 *
 * @throws {InsufficientBalanceError} when a debit would take the balance below zero.
 */
export function applyEntry(
  balancePaise: bigint,
  entry: { type: WalletTxnType; direction: WalletTxnDirection; amountPaise: bigint },
): LedgerEntry {
  if (entry.amountPaise <= 0n) {
    // Magnitude, not sign. A "negative credit" is two different things to two readers.
    throw new InvariantViolationError('A ledger amount must be positive.');
  }

  const balanceAfter =
    entry.direction === 'CREDIT'
      ? balancePaise + entry.amountPaise
      : balancePaise - entry.amountPaise;

  // Never negative — not even transiently. The DB check constraint says the same thing,
  // so an overdraw aborts the whole transaction rather than producing a customer who
  // somehow owes the company money.
  if (balanceAfter < 0n) {
    throw new InsufficientBalanceError(balancePaise, entry.amountPaise);
  }

  return { ...entry, balanceAfterPaise: balanceAfter };
}

/**
 * Replays a ledger and checks it against a claimed balance.
 *
 * The wallet's `balancePaise` column is a CACHE — it exists so a read does not have to
 * sum a million rows. The ledger is the truth. This is the function that proves the two
 * still agree, and it is what the tests (and, later, an ops reconciliation job) use to
 * detect a lost update: the classic concurrency bug where two credits read the same
 * balance and one of them silently vanishes.
 */
export function reconcile(
  entries: readonly Pick<LedgerEntry, 'direction' | 'amountPaise' | 'balanceAfterPaise'>[],
  claimedBalancePaise: bigint,
): { ok: boolean; computedBalancePaise: bigint; brokenAtIndex: number | null } {
  let running = 0n;
  let brokenAtIndex: number | null = null;

  for (const [index, entry] of entries.entries()) {
    running =
      entry.direction === 'CREDIT' ? running + entry.amountPaise : running - entry.amountPaise;

    // Every row records the balance it produced. If a stored balanceAfter disagrees with
    // the replay, two writers interleaved without a lock and one update was lost.
    if (brokenAtIndex === null && running !== entry.balanceAfterPaise) {
      brokenAtIndex = index;
    }
  }

  return {
    ok: brokenAtIndex === null && running === claimedBalancePaise,
    computedBalancePaise: running,
    brokenAtIndex,
  };
}
