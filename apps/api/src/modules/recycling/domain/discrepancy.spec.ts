import { calculateDiscrepancy } from './discrepancy';

const TOLERANCE = 5; // percent

const check = (collected: number, confirmed: number, tolerancePercent = TOLERANCE) =>
  calculateDiscrepancy({
    collectedWeightGrams: collected,
    confirmedWeightGrams: confirmed,
    tolerancePercent,
  });

describe('calculateDiscrepancy', () => {
  it('reports no discrepancy when the weights agree exactly', () => {
    const result = check(100_000, 100_000);

    expect(result.discrepancyGrams).toBe(0);
    expect(result.discrepancyBps).toBe(0);
    expect(result.flagged).toBe(false);
    expect(result.direction).toBe('EXACT');
  });

  it('reports a SHORT load with a negative discrepancy', () => {
    // 100 kg sent, 97 kg arrived: 3% light. Moisture and spillage — physics, not theft.
    const result = check(100_000, 97_000);

    expect(result.discrepancyGrams).toBe(-3000);
    expect(result.discrepancyBps).toBe(-300);
    expect(result.direction).toBe('SHORT');
    expect(result.flagged).toBe(false);
  });

  it('reports an OVER load with a positive discrepancy', () => {
    // Rain. Or someone else's paper on the truck. Either way, worth knowing.
    const result = check(100_000, 102_000);

    expect(result.discrepancyGrams).toBe(2000);
    expect(result.discrepancyBps).toBe(200);
    expect(result.direction).toBe('OVER');
  });

  describe('the tolerance boundary', () => {
    it('does NOT flag a load exactly at the tolerance', () => {
      // Exactly 5% light, with a 5% tolerance. Within tolerance means within.
      const result = check(100_000, 95_000);

      expect(result.discrepancyBps).toBe(-500);
      expect(result.flagged).toBe(false);
    });

    it('flags a load one gram past the tolerance', () => {
      // The boundary is where a "physics" gap becomes an "incident" gap, so it is the one
      // place the arithmetic has to be exactly right.
      const result = check(100_000, 94_990);

      expect(result.discrepancyBps).toBe(-501);
      expect(result.flagged).toBe(true);
    });

    it('flags a large shortfall — the case this whole feature exists for', () => {
      // A quarter of the load is gone. That is not moisture.
      const result = check(200_000, 150_000);

      expect(result.discrepancyGrams).toBe(-50_000);
      expect(result.discrepancyBps).toBe(-2500);
      expect(result.flagged).toBe(true);
      expect(result.direction).toBe('SHORT');
    });

    it('flags an excess as readily as a shortfall', () => {
      // Not just theft-shaped problems: a load arriving 30% heavy means somebody's paper is
      // being credited to the wrong batch, and Phase 6 would report tonnage we never
      // collected.
      const result = check(100_000, 130_000);

      expect(result.flagged).toBe(true);
      expect(result.direction).toBe('OVER');
    });
  });

  describe('rounding', () => {
    it('keeps the EXACT gram truth even when the ratio rounds to zero', () => {
      // One gram in a tonne is 0.01 basis points. Rounding that UP to 1 bps — the tempting
      // "never hide a discrepancy" rule — would overstate the ratio a hundredfold in every
      // report built on this field. The ratio is allowed to read as negligible, because
      // `discrepancyGrams` still carries the truth untouched, and that is the column an
      // investigation actually reads.
      const result = check(1_000_000, 999_999);

      expect(result.discrepancyGrams).toBe(-1);
      expect(result.discrepancyBps).toBe(0);
    });

    it('rounds halves away from zero, symmetrically in both directions', () => {
      // 5 g in 100 kg is exactly 0.5 bps.
      expect(check(100_000, 99_995).discrepancyBps).toBe(-1);
      expect(check(100_000, 100_005).discrepancyBps).toBe(1);
    });

    it('never produces negative zero', () => {
      // `-0` is not `0` under Object.is, so a "no discrepancy" row could fail an equality
      // check in a report and be miscounted as a finding.
      const result = check(100_000, 100_000);

      expect(Object.is(result.discrepancyBps, -0)).toBe(false);
      expect(result.discrepancyBps).toBe(0);
    });

    it('always produces an integer number of basis points', () => {
      for (let confirmed = 90_000; confirmed <= 110_000; confirmed += 137) {
        const result = check(100_000, confirmed);

        expect(Number.isInteger(result.discrepancyBps)).toBe(true);
        expect(Number.isInteger(result.discrepancyGrams)).toBe(true);
      }
    });
  });

  describe('degenerate inputs', () => {
    it('does not divide by zero on an empty batch', () => {
      // Should be unreachable (a batch has a minimum dispatch weight), but Infinity or NaN
      // here would silently poison every downstream ESG report rather than failing loudly.
      const result = check(0, 5000);

      expect(Number.isFinite(result.discrepancyBps)).toBe(true);
      expect(result.discrepancyGrams).toBe(5000);
      // Weight arriving from a batch we recorded as empty is an incident by definition.
      expect(result.flagged).toBe(true);
    });

    it('treats an empty batch confirmed as empty as exact', () => {
      const result = check(0, 0);

      expect(result.flagged).toBe(false);
      expect(result.direction).toBe('EXACT');
    });

    it('handles a mill reporting zero — the load never arrived', () => {
      const result = check(100_000, 0);

      expect(result.discrepancyGrams).toBe(-100_000);
      expect(result.discrepancyBps).toBe(-10_000); // -100%
      expect(result.flagged).toBe(true);
    });

    it('rejects fractional or negative weights', () => {
      expect(() => check(100_000.5, 99_000)).toThrow(RangeError);
      expect(() => check(-100, 99_000)).toThrow(RangeError);
      expect(() => check(100_000, -1)).toThrow(RangeError);
    });
  });

  it('honours a stricter tolerance', () => {
    // A mill we trust less, or a high-value grade of paper.
    const lenient = check(100_000, 98_000, 5);
    const strict = check(100_000, 98_000, 1);

    expect(lenient.flagged).toBe(false);
    expect(strict.flagged).toBe(true);
  });
});
