/**
 * Weighbridge discrepancy: what we weighed at the door vs what the mill weighed at the gate.
 *
 * Two real measurements, taken by different parties, with different instruments, hours
 * apart. They will not agree, and that is not a bug — paper genuinely loses moisture in
 * transit, some spills, and a weighbridge has its own tolerance.
 *
 * The job of this module is to say how big the gap is, and whether it is the kind of gap
 * that is physics or the kind that is an incident. What it must NEVER do is make the two
 * numbers agree: overwriting our collected weight with the mill's confirmation destroys
 * the only evidence that there was a difference, and with it any chance of noticing that
 * one particular transporter's loads always arrive 12% light.
 */

export interface DiscrepancyInput {
  /** What WE weighed at customers' doors, summed over the batch. Integer grams. */
  collectedWeightGrams: number;
  /** What the MILL's weighbridge reported. Integer grams. */
  confirmedWeightGrams: number;
  /** Variance accepted without flagging, e.g. 5 for 5%. */
  tolerancePercent: number;
}

export interface Discrepancy {
  /** confirmed - collected. NEGATIVE means the load arrived light (the usual direction). */
  discrepancyGrams: number;

  /**
   * The same figure as a signed share of the collected weight, in BASIS POINTS.
   * -250 = the load arrived 2.5% light.
   *
   * Basis points (integers), not a float percentage, for exactly the reason money is in
   * paise: this number gets compared against a threshold, summed into reports, and shown
   * to a mill during a commercial dispute. A float that renders as 2.4999999996% in one
   * report and 2.5% in another is an argument nobody wants to have.
   */
  discrepancyBps: number;

  /** True when |discrepancy| exceeds the tolerance. Physics below, incident above. */
  flagged: boolean;

  /** Which way it went. Useful enough to name rather than make every caller re-derive. */
  direction: 'SHORT' | 'OVER' | 'EXACT';
}

const BPS_PER_UNIT = 10_000;

export function calculateDiscrepancy(input: DiscrepancyInput): Discrepancy {
  const { collectedWeightGrams, confirmedWeightGrams, tolerancePercent } = input;

  if (!Number.isInteger(collectedWeightGrams) || collectedWeightGrams < 0) {
    throw new RangeError(`collectedWeightGrams must be a non-negative integer`);
  }

  if (!Number.isInteger(confirmedWeightGrams) || confirmedWeightGrams < 0) {
    throw new RangeError(`confirmedWeightGrams must be a non-negative integer`);
  }

  const discrepancyGrams = confirmedWeightGrams - collectedWeightGrams;

  // A batch of zero collected grams cannot be expressed as a percentage of itself. It
  // should never be dispatched (the batching job has a minimum weight), but a division by
  // zero here would produce Infinity or NaN and silently poison every downstream report.
  if (collectedWeightGrams === 0) {
    return {
      discrepancyGrams,
      discrepancyBps: 0,
      // Any weight arriving from a batch we recorded as empty is an incident by definition.
      flagged: discrepancyGrams !== 0,
      direction: discrepancyGrams === 0 ? 'EXACT' : 'OVER',
    };
  }

  // Rounded to the NEAREST basis point, halves away from zero.
  //
  // Deliberately not "always round away from zero". That was the first instinct — keep even
  // a one-gram shortfall visible — but it is wrong: one gram in a tonne is 0.01 bps, and
  // forcing it to 1 bps overstates the ratio a hundredfold in every report built on it. The
  // exact truth is not lost, because `discrepancyGrams` carries it untouched; this field is
  // a RATIO, and a negligible ratio should read as negligible.
  const exactBps = (discrepancyGrams * BPS_PER_UNIT) / collectedWeightGrams;
  const rounded = exactBps >= 0 ? Math.round(exactBps) : -Math.round(-exactBps);

  // `Math.round(-0.4)` is -0, and `-0 !== 0` is false but `Object.is(-0, 0)` is false —
  // which means a "no discrepancy" row can serialise as `-0` and fail an equality check in
  // a report. Normalise it away at the source.
  const discrepancyBps = rounded === 0 ? 0 : rounded;

  const toleranceBps = Math.round(tolerancePercent * 100);

  return {
    discrepancyGrams,
    discrepancyBps,
    // Strictly greater: a load exactly at the tolerance is within tolerance.
    flagged: Math.abs(discrepancyBps) > toleranceBps,
    direction: discrepancyGrams === 0 ? 'EXACT' : discrepancyGrams < 0 ? 'SHORT' : 'OVER',
  };
}
