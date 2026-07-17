import { InvariantViolationError } from '@/shared/domain/errors/domain.error';
import { calculateOrderTotals, paiseToRupees, priceLine, splitPayment } from './pricing';

describe('priceLine', () => {
  it('multiplies unit price by quantity', () => {
    expect(priceLine({ unitPricePaise: 14999, quantity: 3 })).toEqual({
      unitPricePaise: 14999,
      quantity: 3,
      lineTotalPaise: 44997,
    });
  });

  it('rejects a zero or negative quantity', () => {
    expect(() => priceLine({ unitPricePaise: 100, quantity: 0 })).toThrow(InvariantViolationError);
    expect(() => priceLine({ unitPricePaise: 100, quantity: -1 })).toThrow(InvariantViolationError);
  });

  it('rejects a fractional or negative price', () => {
    expect(() => priceLine({ unitPricePaise: 10.5, quantity: 1 })).toThrow(InvariantViolationError);
    expect(() => priceLine({ unitPricePaise: -1, quantity: 1 })).toThrow(InvariantViolationError);
  });
});

describe('calculateOrderTotals', () => {
  it('sums line totals; subtotal equals total in this phase', () => {
    const totals = calculateOrderTotals([
      { unitPricePaise: 10000, quantity: 2 }, // 20000
      { unitPricePaise: 4999, quantity: 3 }, // 14997
    ]);
    expect(totals.subtotalPaise).toBe(34997);
    expect(totals.totalPaise).toBe(34997);
    expect(totals.lines).toHaveLength(2);
  });

  it('refuses an empty order', () => {
    expect(() => calculateOrderTotals([])).toThrow(InvariantViolationError);
  });
});

describe('splitPayment', () => {
  it('applies the full wallet when it covers the whole order', () => {
    expect(
      splitPayment({ totalPaise: 5000, walletBalancePaise: 8000, requestedWalletPaise: 8000 }),
    ).toEqual({ walletPaise: 5000, gatewayPaise: 0 });
  });

  it('caps the wallet portion at the balance, gateway covers the rest', () => {
    expect(
      splitPayment({ totalPaise: 5000, walletBalancePaise: 2000, requestedWalletPaise: 5000 }),
    ).toEqual({ walletPaise: 2000, gatewayPaise: 3000 });
  });

  it('caps the wallet portion at what the customer requested', () => {
    expect(
      splitPayment({ totalPaise: 5000, walletBalancePaise: 9000, requestedWalletPaise: 1500 }),
    ).toEqual({ walletPaise: 1500, gatewayPaise: 3500 });
  });

  it('a zero wallet request is a pure gateway order', () => {
    expect(
      splitPayment({ totalPaise: 5000, walletBalancePaise: 9000, requestedWalletPaise: 0 }),
    ).toEqual({ walletPaise: 0, gatewayPaise: 5000 });
  });

  it('never lets the wallet exceed the order total even with a huge balance', () => {
    expect(
      splitPayment({
        totalPaise: 300,
        walletBalancePaise: 10_00_000,
        requestedWalletPaise: 999999,
      }),
    ).toEqual({ walletPaise: 300, gatewayPaise: 0 });
  });

  it('ALWAYS sums to the total — the identity the atomic flow depends on', () => {
    for (const total of [0, 1, 99, 100, 4999, 500000]) {
      for (const balance of [0, 50, 4999, 500000]) {
        for (const requested of [0, 50, 4999, 500000]) {
          const split = splitPayment({
            totalPaise: total,
            walletBalancePaise: balance,
            requestedWalletPaise: requested,
          });
          expect(split.walletPaise + split.gatewayPaise).toBe(total);
          expect(split.walletPaise).toBeGreaterThanOrEqual(0);
          expect(split.gatewayPaise).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('rejects fractional or negative inputs', () => {
    expect(() =>
      splitPayment({ totalPaise: 100.5, walletBalancePaise: 0, requestedWalletPaise: 0 }),
    ).toThrow(InvariantViolationError);
    expect(() =>
      splitPayment({ totalPaise: 100, walletBalancePaise: -1, requestedWalletPaise: 0 }),
    ).toThrow(InvariantViolationError);
  });
});

describe('paiseToRupees', () => {
  it('formats with two decimals', () => {
    expect(paiseToRupees(0)).toBe('0.00');
    expect(paiseToRupees(5)).toBe('0.05');
    expect(paiseToRupees(199)).toBe('1.99');
    expect(paiseToRupees(500000)).toBe('5000.00');
  });
});
