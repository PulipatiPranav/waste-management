import { InvariantViolationError } from '@/shared/domain/errors/domain.error';
import { applyEntry, InsufficientBalanceError, reconcile, type LedgerEntry } from './ledger';

describe('applyEntry', () => {
  it('credits', () => {
    const entry = applyEntry(1000n, {
      type: 'PICKUP_CASHBACK',
      direction: 'CREDIT',
      amountPaise: 500n,
    });

    expect(entry.balanceAfterPaise).toBe(1500n);
  });

  it('debits', () => {
    const entry = applyEntry(1000n, {
      type: 'WITHDRAWAL_DEBIT',
      direction: 'DEBIT',
      amountPaise: 400n,
    });

    expect(entry.balanceAfterPaise).toBe(600n);
  });

  it('allows a debit down to exactly zero', () => {
    const entry = applyEntry(1000n, {
      type: 'WITHDRAWAL_DEBIT',
      direction: 'DEBIT',
      amountPaise: 1000n,
    });

    expect(entry.balanceAfterPaise).toBe(0n);
  });

  it('refuses a debit that would overdraw, by one paisa', () => {
    // The boundary. A customer who somehow owes the company money is a bug that shows up
    // in an accountant's spreadsheet weeks later.
    expect(() =>
      applyEntry(1000n, { type: 'WITHDRAWAL_DEBIT', direction: 'DEBIT', amountPaise: 1001n }),
    ).toThrow(InsufficientBalanceError);
  });

  it('refuses a zero or negative amount', () => {
    // Amount is magnitude; direction carries the sign. A "-500 CREDIT" would mean two
    // different things to two readers.
    expect(() =>
      applyEntry(1000n, { type: 'ADJUSTMENT', direction: 'CREDIT', amountPaise: 0n }),
    ).toThrow(InvariantViolationError);

    expect(() =>
      applyEntry(1000n, { type: 'ADJUSTMENT', direction: 'CREDIT', amountPaise: -500n }),
    ).toThrow(InvariantViolationError);
  });

  it('handles balances beyond Number.MAX_SAFE_INTEGER', () => {
    // Why the balance is BigInt and not number. A number-based ledger would start losing
    // paise silently at ~₹90 trillion — absurd for one wallet, entirely plausible for a
    // lifetime platform total, and a silent corruption is the worst kind.
    const huge = 9_007_199_254_740_993n;

    const entry = applyEntry(huge, {
      type: 'PICKUP_CASHBACK',
      direction: 'CREDIT',
      amountPaise: 2n,
    });

    expect(entry.balanceAfterPaise).toBe(9_007_199_254_740_995n);
  });
});

describe('reconcile', () => {
  const entry = (
    direction: 'CREDIT' | 'DEBIT',
    amount: bigint,
    balanceAfter: bigint,
  ): Pick<LedgerEntry, 'direction' | 'amountPaise' | 'balanceAfterPaise'> => ({
    direction,
    amountPaise: amount,
    balanceAfterPaise: balanceAfter,
  });

  it('accepts a consistent ledger', () => {
    const result = reconcile(
      [entry('CREDIT', 1000n, 1000n), entry('CREDIT', 500n, 1500n), entry('DEBIT', 200n, 1300n)],
      1300n,
    );

    expect(result.ok).toBe(true);
    expect(result.computedBalancePaise).toBe(1300n);
    expect(result.brokenAtIndex).toBeNull();
  });

  it('accepts an empty ledger against a zero balance', () => {
    expect(reconcile([], 0n).ok).toBe(true);
  });

  it('detects a wallet balance that disagrees with its ledger', () => {
    const result = reconcile([entry('CREDIT', 1000n, 1000n)], 9999n);

    expect(result.ok).toBe(false);
    expect(result.computedBalancePaise).toBe(1000n);
  });

  it('detects a LOST UPDATE, and points at the row where it happened', () => {
    // The exact shape of the bug this whole locking design exists to prevent: two
    // concurrent credits both read balance=1000, both write balanceAfter=1500, and one
    // of them is silently gone. Replaying the ledger catches it because the second row's
    // stored balanceAfter no longer matches the running total.
    const result = reconcile(
      [
        entry('CREDIT', 1000n, 1000n),
        entry('CREDIT', 500n, 1500n),
        entry('CREDIT', 500n, 1500n), // <- should have been 2000
      ],
      1500n,
    );

    expect(result.ok).toBe(false);
    expect(result.brokenAtIndex).toBe(2);
    expect(result.computedBalancePaise).toBe(2000n);
  });
});
