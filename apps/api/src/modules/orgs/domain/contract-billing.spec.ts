import { InvariantViolationError } from '@/shared/domain/errors/domain.error';
import {
  computeInvoiceAmount,
  monthlyPeriod,
  monthsInRange,
  type ContractTerms,
} from './contract-billing';

const flat = (paise: number): ContractTerms => ({
  type: 'FLAT_MONTHLY',
  flatAmountPaise: paise,
  perKgRatePaise: null,
});
const perKg = (paise: number): ContractTerms => ({
  type: 'PER_KG',
  flatAmountPaise: null,
  perKgRatePaise: paise,
});

describe('computeInvoiceAmount', () => {
  describe('FLAT_MONTHLY', () => {
    it('bills the flat amount regardless of volume', () => {
      // ₹5000/month, whatever was recycled.
      expect(computeInvoiceAmount(flat(500_000), 0).amountPaise).toBe(500_000);
      expect(computeInvoiceAmount(flat(500_000), 5_000_000).amountPaise).toBe(500_000);
    });

    it('records the recycled weight on the invoice even though it does not affect the amount', () => {
      // The ESG report needs the weight; the bill does not depend on it.
      expect(computeInvoiceAmount(flat(500_000), 40_000).recycledGrams).toBe(40_000);
    });

    it('allows a zero flat amount (a goodwill / pilot contract)', () => {
      expect(computeInvoiceAmount(flat(0), 100_000).amountPaise).toBe(0);
    });
  });

  describe('PER_KG', () => {
    it('bills a clean kilogram exactly', () => {
      // 10 kg at ₹8/kg = ₹80.00.
      expect(computeInvoiceAmount(perKg(800), 10_000).amountPaise).toBe(8000);
    });

    it('bills a fractional weight with a single half-up rounding', () => {
      // 1235 g at ₹1.50/kg = 185.25 paise → 185.
      expect(computeInvoiceAmount(perKg(150), 1235).amountPaise).toBe(185);
      // 1237 g at ₹1.50/kg = 185.55 paise → 186.
      expect(computeInvoiceAmount(perKg(150), 1237).amountPaise).toBe(186);
    });

    it('rounds exactly .5 of a paisa up', () => {
      // 500 g at 1 paise/kg = 0.5 paise → 1.
      expect(computeInvoiceAmount(perKg(1), 500).amountPaise).toBe(1);
    });

    it('bills nothing for a month with no confirmed recycling', () => {
      expect(computeInvoiceAmount(perKg(800), 0).amountPaise).toBe(0);
    });

    it('always produces a whole number of paise', () => {
      for (let grams = 1; grams < 10_000; grams += 137) {
        const amount = computeInvoiceAmount(perKg(933), grams).amountPaise;
        expect(Number.isInteger(amount)).toBe(true);
      }
    });
  });

  describe('rejections', () => {
    it('rejects fractional or negative recycled grams', () => {
      expect(() => computeInvoiceAmount(perKg(800), 100.5)).toThrow(InvariantViolationError);
      expect(() => computeInvoiceAmount(perKg(800), -1)).toThrow(InvariantViolationError);
    });

    it('rejects a flat contract with no amount', () => {
      expect(() =>
        computeInvoiceAmount(
          { type: 'FLAT_MONTHLY', flatAmountPaise: null, perKgRatePaise: null },
          0,
        ),
      ).toThrow(InvariantViolationError);
    });

    it('rejects a per-kg contract with no rate', () => {
      expect(() =>
        computeInvoiceAmount({ type: 'PER_KG', flatAmountPaise: null, perKgRatePaise: null }, 100),
      ).toThrow(InvariantViolationError);
    });
  });
});

describe('monthlyPeriod', () => {
  it('spans a calendar month', () => {
    const period = monthlyPeriod('2026-07');
    expect(period.start.toString()).toBe('2026-07-01');
    expect(period.end.toString()).toBe('2026-07-31');
    expect(period.label).toBe('2026-07');
  });

  it('ends February on the 28th, and the 29th in a leap year', () => {
    expect(monthlyPeriod('2026-02').end.toString()).toBe('2026-02-28');
    expect(monthlyPeriod('2028-02').end.toString()).toBe('2028-02-29');
  });

  it('rejects a malformed month', () => {
    expect(() => monthlyPeriod('2026-13')).toThrow(InvariantViolationError);
    expect(() => monthlyPeriod('2026-7')).toThrow(InvariantViolationError);
    expect(() => monthlyPeriod('July')).toThrow(InvariantViolationError);
  });
});

describe('monthsInRange', () => {
  it('lists a single month', () => {
    expect(monthsInRange('2026-07', '2026-07')).toEqual(['2026-07']);
  });

  it('lists a quarter', () => {
    expect(monthsInRange('2026-07', '2026-09')).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('crosses a year boundary', () => {
    expect(monthsInRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('rejects an inverted range', () => {
    expect(() => monthsInRange('2026-09', '2026-07')).toThrow(InvariantViolationError);
  });
});
