import {
  calculateCashback,
  calculateItemCashbackPaise,
  gramsToKg,
  paiseToRupees,
  type WeighedItem,
} from './money';

describe('calculateItemCashbackPaise', () => {
  it('prices a clean kilogram exactly', () => {
    // 1 kg at ₹15.00/kg = ₹15.00.
    expect(calculateItemCashbackPaise(1000, 1500)).toBe(1500);
  });

  it('prices a whole number of kilograms exactly', () => {
    expect(calculateItemCashbackPaise(5000, 1200)).toBe(6000);
  });

  it('prices a fractional weight with no float error', () => {
    // 2.5 kg at ₹12.00/kg = ₹30.00. A float path would be 2.5 * 12 = 30.000000000000004
    // in some orderings; integer grams × integer paise cannot drift.
    expect(calculateItemCashbackPaise(2500, 1200)).toBe(3000);
  });

  describe('the rounding rule (half up, applied exactly once)', () => {
    it('rounds .5 of a paisa UP', () => {
      // 1500 g × 1 paise/kg = 1.5 paise -> 2.
      expect(calculateItemCashbackPaise(1500, 1)).toBe(2);
    });

    it('rounds below .5 down', () => {
      // 1499 g × 1 = 1.499 paise -> 1.
      expect(calculateItemCashbackPaise(1499, 1)).toBe(1);
    });

    it('rounds above .5 up', () => {
      // 1501 g × 1 = 1.501 -> 2.
      expect(calculateItemCashbackPaise(1501, 1)).toBe(2);
    });

    it('handles the awkward case from the schema comment', () => {
      // 1235 g at ₹14.99/kg = 1851.265 paise -> 1851.
      expect(calculateItemCashbackPaise(1235, 1499)).toBe(1851);
    });

    it('always returns a whole number of paise', () => {
      for (let grams = 1; grams <= 3000; grams += 7) {
        for (const rate of [1, 7, 999, 1499, 1500]) {
          const amount = calculateItemCashbackPaise(grams, rate);
          expect(Number.isInteger(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('never differs from the exact value by more than half a paisa', () => {
      // The definition of correct rounding. If this ever fails, the rule has drifted.
      for (let grams = 1; grams <= 5000; grams += 13) {
        const rate = 1499;
        const exact = (grams * rate) / 1000;
        const rounded = calculateItemCashbackPaise(grams, rate);

        expect(Math.abs(rounded - exact)).toBeLessThanOrEqual(0.5);
      }
    });
  });

  it('prices a zero rate as zero rather than failing', () => {
    expect(calculateItemCashbackPaise(5000, 0)).toBe(0);
  });

  it('rejects a fractional weight — grams are integers', () => {
    // A float kilogram sneaking in as `2.5` grams is a units bug, and silently flooring
    // it would under-pay the customer forever without anybody noticing.
    expect(() => calculateItemCashbackPaise(1000.5, 1500)).toThrow(RangeError);
  });

  it('rejects negative weight and negative rates', () => {
    expect(() => calculateItemCashbackPaise(-1000, 1500)).toThrow(RangeError);
    expect(() => calculateItemCashbackPaise(1000, -1500)).toThrow(RangeError);
  });
});

describe('calculateCashback', () => {
  const items: WeighedItem[] = [
    { paperType: 'NEWSPAPER', weightGrams: 5250, ratePerKgPaise: 1500 },
    { paperType: 'CARDBOARD', weightGrams: 3100, ratePerKgPaise: 900 },
    { paperType: 'MAGAZINE', weightGrams: 750, ratePerKgPaise: 1200 },
  ];

  it('prices each line and totals them', () => {
    const result = calculateCashback(items);

    // 5.25 kg × ₹15   = ₹78.75  = 7875 paise
    // 3.10 kg × ₹9    = ₹27.90  = 2790 paise
    // 0.75 kg × ₹12   = ₹9.00   =  900 paise
    expect(result.lines.map((line) => line.amountPaise)).toEqual([7875, 2790, 900]);
    expect(result.totalPaise).toBe(11565);
    expect(result.totalWeightGrams).toBe(9100);
  });

  it('totals to the SUM OF THE ROUNDED LINES, not a re-rounding of the exact total', () => {
    // Three lines that each round down by just under half a paisa. Rounding the exact
    // grand total would give a different answer to summing the rounded lines — and the
    // customer's receipt shows the LINES. If the ledger used the other figure, every
    // reconciliation would be a paisa out and nobody would know which number was right.
    const awkward: WeighedItem[] = [
      { paperType: 'NEWSPAPER', weightGrams: 1499, ratePerKgPaise: 1 },
      { paperType: 'MAGAZINE', weightGrams: 1499, ratePerKgPaise: 1 },
      { paperType: 'CARDBOARD', weightGrams: 1499, ratePerKgPaise: 1 },
    ];

    const result = calculateCashback(awkward);

    // Each line: 1.499 paise -> 1. Sum of lines = 3.
    expect(result.lines.map((line) => line.amountPaise)).toEqual([1, 1, 1]);
    expect(result.totalPaise).toBe(3);

    // Whereas the exact total is 4.497 paise, which would round to 4. The system must
    // pay 3 — the sum of what it showed the customer — not 4.
    const exactTotal = (1499 * 1 * 3) / 1000;
    expect(Math.round(exactTotal)).toBe(4);
    expect(result.totalPaise).not.toBe(Math.round(exactTotal));
  });

  it('is exactly reconcilable: the total always equals the sum of the stored lines', () => {
    // The property the ledger depends on. Asserted over a spread of awkward inputs
    // rather than one lucky example.
    for (let grams = 1; grams < 4000; grams += 101) {
      const breakdown = calculateCashback([
        { paperType: 'NEWSPAPER', weightGrams: grams, ratePerKgPaise: 1499 },
        { paperType: 'CARDBOARD', weightGrams: grams + 7, ratePerKgPaise: 933 },
      ]);

      const sum = breakdown.lines.reduce((total, line) => total + line.amountPaise, 0);
      expect(breakdown.totalPaise).toBe(sum);
    }
  });

  it('rejects two lines of the same paper type', () => {
    // Would double-count the customer's newspapers. The DB has the same unique rule; this
    // check exists so the partner sees a sensible error instead of a constraint violation.
    expect(() =>
      calculateCashback([
        { paperType: 'NEWSPAPER', weightGrams: 1000, ratePerKgPaise: 1500 },
        { paperType: 'NEWSPAPER', weightGrams: 2000, ratePerKgPaise: 1500 },
      ]),
    ).toThrow(RangeError);
  });

  it('prices an empty pickup as zero', () => {
    const result = calculateCashback([]);

    expect(result.totalPaise).toBe(0);
    expect(result.totalWeightGrams).toBe(0);
  });
});

describe('display formatting', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [50, '0.50'],
    [100, '1.00'],
    [11565, '115.65'],
    [-250, '-2.50'],
  ])('formats %i paise as ₹%s', (paise, expected) => {
    expect(paiseToRupees(paise)).toBe(expected);
  });

  it('formats a bigint balance without precision loss', () => {
    // Beyond Number.MAX_SAFE_INTEGER: a number-based formatter would silently corrupt
    // this, which is precisely why balances are BigInt.
    expect(paiseToRupees(9_007_199_254_740_993n)).toBe('90071992547409.93');
  });

  it('formats grams as kilograms', () => {
    expect(gramsToKg(5250)).toBe('5.250');
    expect(gramsToKg(0)).toBe('0.000');
  });
});
