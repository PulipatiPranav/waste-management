import { Day } from '../value-objects/day';
import { countIssues } from '../value-objects/delivery-frequency';
import { billingPeriodFor, calculateProration, type ProrationInput } from './proration.service';

const PRICE = 450; // ₹4.50 per issue, in paise

/** July 2026: 31 days, starts on a Wednesday. */
const JULY = { from: Day.parse('2026-07-01'), to: Day.parse('2026-07-31') };

const base = (overrides: Partial<ProrationInput> = {}): ProrationInput => ({
  period: JULY,
  frequency: 'DAILY',
  pricePerIssuePaise: PRICE,
  startDate: Day.parse('2026-07-01'),
  cancelledOn: null,
  pauses: [],
  ...overrides,
});

describe('calculateProration', () => {
  describe('a full period', () => {
    it('charges for every day of a 31-day month', () => {
      const result = calculateProration(base());

      expect(result.billableIssues).toBe(31);
      expect(result.amountPaise).toBe(31 * PRICE);
      expect(result.isProrated).toBe(false);
    });

    it('charges 28 issues in a non-leap February and 29 in a leap one', () => {
      const feb2026 = calculateProration(
        base({
          period: { from: Day.parse('2026-02-01'), to: Day.parse('2026-02-28') },
          startDate: Day.parse('2026-02-01'),
        }),
      );

      const feb2028 = calculateProration(
        base({
          period: { from: Day.parse('2028-02-01'), to: Day.parse('2028-02-29') },
          startDate: Day.parse('2028-02-01'),
        }),
      );

      // Per-issue pricing is why this is simply true, rather than a rounding decision:
      // the customer pays for the issues they get, and February has fewer.
      expect(feb2026.billableIssues).toBe(28);
      expect(feb2028.billableIssues).toBe(29);
    });
  });

  describe('mid-cycle start', () => {
    it('bills only from the start date, inclusive', () => {
      const result = calculateProration(base({ startDate: Day.parse('2026-07-17') }));

      // 17th..31st inclusive = 15 days. NOT 14 (excluding the 17th) and NOT 16.
      // This single assertion is the off-by-one the whole design is built to avoid.
      expect(result.billableIssues).toBe(15);
      expect(result.amountPaise).toBe(15 * PRICE);
      expect(result.isProrated).toBe(true);
    });

    it('bills exactly one issue when the subscription starts on the last day', () => {
      const result = calculateProration(base({ startDate: Day.parse('2026-07-31') }));

      expect(result.billableIssues).toBe(1);
    });

    it('bills nothing when the subscription starts after the period ends', () => {
      const result = calculateProration(base({ startDate: Day.parse('2026-08-01') }));

      expect(result.billableIssues).toBe(0);
      expect(result.amountPaise).toBe(0);
    });

    it('ignores a start date before the period — it does not bill backwards', () => {
      const result = calculateProration(base({ startDate: Day.parse('2026-05-03') }));

      expect(result.billableIssues).toBe(31);
      expect(result.isProrated).toBe(false);
    });

    it('splits a month cleanly: the two halves add back up to the whole', () => {
      // The property that a naive `price × days/daysInMonth` breaks, because its two
      // rounded halves do not sum to the unrounded whole.
      const first = calculateProration(
        base({ period: { from: JULY.from, to: Day.parse('2026-07-16') } }),
      );
      const second = calculateProration(
        base({ period: { from: Day.parse('2026-07-17'), to: JULY.to } }),
      );
      const whole = calculateProration(base());

      expect(first.amountPaise + second.amountPaise).toBe(whole.amountPaise);
    });
  });

  describe('cancellation', () => {
    it('bills up to and including the cancellation day', () => {
      const result = calculateProration(base({ cancelledOn: Day.parse('2026-07-10') }));

      // 1st..10th inclusive = 10 issues. The customer read the paper on the 10th.
      expect(result.billableIssues).toBe(10);
    });

    it('bills one issue when cancelled on the first day', () => {
      const result = calculateProration(base({ cancelledOn: Day.parse('2026-07-01') }));

      expect(result.billableIssues).toBe(1);
    });

    it('bills nothing for a period after cancellation', () => {
      const result = calculateProration(
        base({
          period: { from: Day.parse('2026-08-01'), to: Day.parse('2026-08-31') },
          cancelledOn: Day.parse('2026-07-10'),
        }),
      );

      expect(result.billableIssues).toBe(0);
      expect(result.amountPaise).toBe(0);
    });

    it('handles subscribe and cancel inside the same month', () => {
      const result = calculateProration(
        base({ startDate: Day.parse('2026-07-10'), cancelledOn: Day.parse('2026-07-12') }),
      );

      // 10th, 11th, 12th.
      expect(result.billableIssues).toBe(3);
    });
  });

  describe('pauses', () => {
    it('credits the paused days', () => {
      const result = calculateProration(
        base({
          pauses: [{ pausedFrom: Day.parse('2026-07-10'), resumedFrom: Day.parse('2026-07-15') }],
        }),
      );

      // Paused on 10,11,12,13,14 — five days. Delivery RESUMES on the 15th, so the 15th
      // is billed. 31 - 5 = 26.
      expect(result.pausedIssues).toBe(5);
      expect(result.billableIssues).toBe(26);
      expect(result.amountPaise).toBe(26 * PRICE);
    });

    it('treats resumedFrom as the first delivered day, not the last paused one', () => {
      const result = calculateProration(
        base({
          pauses: [{ pausedFrom: Day.parse('2026-07-10'), resumedFrom: Day.parse('2026-07-11') }],
        }),
      );

      // Exactly one day skipped (the 10th). Reading resumedFrom as inclusive-of-pause
      // would credit two, and every pause in the system would be one day too generous.
      expect(result.pausedIssues).toBe(1);
      expect(result.billableIssues).toBe(30);
    });

    it('credits a single day when paused and resumed the next day', () => {
      const result = calculateProration(
        base({
          startDate: Day.parse('2026-07-01'),
          pauses: [{ pausedFrom: Day.parse('2026-07-31'), resumedFrom: null }],
        }),
      );

      expect(result.billableIssues).toBe(30);
    });

    it('runs an open pause to the end of the period', () => {
      const result = calculateProration(
        base({ pauses: [{ pausedFrom: Day.parse('2026-07-25'), resumedFrom: null }] }),
      );

      // 25th..31st = 7 days skipped.
      expect(result.pausedIssues).toBe(7);
      expect(result.billableIssues).toBe(24);
    });

    it('counts two pauses in one month separately', () => {
      const result = calculateProration(
        base({
          pauses: [
            { pausedFrom: Day.parse('2026-07-05'), resumedFrom: Day.parse('2026-07-08') }, // 5,6,7
            { pausedFrom: Day.parse('2026-07-20'), resumedFrom: Day.parse('2026-07-22') }, // 20,21
          ],
        }),
      );

      // Exactly why pauses are an append-only log rather than two columns on the
      // subscription row: collapsing them would lose the first window and overcharge.
      expect(result.pausedIssues).toBe(5);
      expect(result.billableIssues).toBe(26);
    });

    it('only credits the part of a pause that overlaps THIS period', () => {
      // A pause spanning June -> August, viewed from July: the whole of July is paused,
      // but it must not also be credited against June's or August's invoice.
      const result = calculateProration(
        base({
          pauses: [{ pausedFrom: Day.parse('2026-06-20'), resumedFrom: Day.parse('2026-08-10') }],
        }),
      );

      expect(result.pausedIssues).toBe(31);
      expect(result.billableIssues).toBe(0);
      expect(result.amountPaise).toBe(0);
    });

    it('ignores a pause that falls entirely outside the period', () => {
      const result = calculateProration(
        base({
          pauses: [{ pausedFrom: Day.parse('2026-03-01'), resumedFrom: Day.parse('2026-03-10') }],
        }),
      );

      expect(result.pausedIssues).toBe(0);
      expect(result.billableIssues).toBe(31);
    });

    it('never produces a negative bill, even from overlapping pause windows', () => {
      // The DB's one-open-pause index makes this unreachable through the API, but a bad
      // backfill could still write it — and a negative amount would pay the customer to
      // read the newspaper.
      const result = calculateProration(
        base({
          pauses: [
            { pausedFrom: Day.parse('2026-07-01'), resumedFrom: Day.parse('2026-08-01') },
            { pausedFrom: Day.parse('2026-07-01'), resumedFrom: Day.parse('2026-08-01') },
          ],
        }),
      );

      expect(result.billableIssues).toBe(0);
      expect(result.amountPaise).toBe(0);
      expect(result.amountPaise).toBeGreaterThanOrEqual(0);
    });
  });

  describe('start, pause and cancel interacting', () => {
    it('bills correctly when all three happen in one month', () => {
      const result = calculateProration(
        base({
          startDate: Day.parse('2026-07-05'),
          cancelledOn: Day.parse('2026-07-25'),
          pauses: [{ pausedFrom: Day.parse('2026-07-10'), resumedFrom: Day.parse('2026-07-20') }],
        }),
      );

      // Live 5th..25th = 21 issues. Paused 10th..19th = 10 issues. 21 - 10 = 11.
      expect(result.billableIssues).toBe(11);
      expect(result.amountPaise).toBe(11 * PRICE);
    });

    it('clips a pause that extends past the cancellation date', () => {
      const result = calculateProration(
        base({
          startDate: Day.parse('2026-07-01'),
          cancelledOn: Day.parse('2026-07-15'),
          pauses: [{ pausedFrom: Day.parse('2026-07-10'), resumedFrom: null }],
        }),
      );

      // Live 1st..15th = 15. Paused 10th..15th = 6 (the open pause is clipped at the
      // cancellation date, not run to the end of the month — otherwise the credit would
      // exceed the charge).
      expect(result.billableIssues).toBe(9);
      expect(result.pausedIssues).toBe(6);
    });
  });

  describe('non-daily frequencies', () => {
    it('bills WEEKDAYS for weekdays only', () => {
      const result = calculateProration(base({ frequency: 'WEEKDAYS' }));

      // July 2026 has 23 weekdays.
      expect(result.billableIssues).toBe(countIssues('WEEKDAYS', JULY.from, JULY.to));
      expect(result.billableIssues).toBe(23);
    });

    it('bills SUNDAY_ONLY for the Sundays', () => {
      const result = calculateProration(base({ frequency: 'SUNDAY_ONLY' }));

      // July 2026: Sundays are the 5th, 12th, 19th, 26th.
      expect(result.billableIssues).toBe(4);
    });

    it('credits nothing for a pause that covers no delivery day', () => {
      // Pausing a SUNDAY_ONLY subscription across a Mon-Fri costs the customer nothing,
      // because they were not going to receive an issue anyway. A day-based proration
      // would wrongly credit five days here.
      const result = calculateProration(
        base({
          frequency: 'SUNDAY_ONLY',
          pauses: [{ pausedFrom: Day.parse('2026-07-06'), resumedFrom: Day.parse('2026-07-11') }],
        }),
      );

      expect(result.pausedIssues).toBe(0);
      expect(result.billableIssues).toBe(4);
    });
  });

  describe('exactness', () => {
    it('produces an exact integer amount with no rounding', () => {
      // 333 paise is deliberately awkward: any float or percentage-based proration
      // would drift here.
      const result = calculateProration(
        base({ pricePerIssuePaise: 333, startDate: Day.parse('2026-07-17') }),
      );

      expect(result.amountPaise).toBe(15 * 333);
      expect(Number.isInteger(result.amountPaise)).toBe(true);
    });

    it('charges zero for a free edition rather than failing', () => {
      const result = calculateProration(base({ pricePerIssuePaise: 0 }));

      expect(result.amountPaise).toBe(0);
      expect(result.billableIssues).toBe(31);
    });
  });
});

describe('billingPeriodFor', () => {
  it('returns the calendar month', () => {
    const period = billingPeriodFor(Day.parse('2026-07-17'), 'MONTHLY');

    expect(period.from.toString()).toBe('2026-07-01');
    expect(period.to.toString()).toBe('2026-07-31');
  });

  it('ends February on the 28th, and on the 29th in a leap year', () => {
    expect(billingPeriodFor(Day.parse('2026-02-10'), 'MONTHLY').to.toString()).toBe('2026-02-28');
    expect(billingPeriodFor(Day.parse('2028-02-10'), 'MONTHLY').to.toString()).toBe('2028-02-29');
  });

  it('returns a fixed calendar quarter', () => {
    const period = billingPeriodFor(Day.parse('2026-08-14'), 'QUARTERLY');

    // Jul-Sep, regardless of when this particular customer joined — every invoice in
    // the system covers the same window.
    expect(period.from.toString()).toBe('2026-07-01');
    expect(period.to.toString()).toBe('2026-09-30');
  });

  it.each([
    ['2026-01-05', '2026-01-01', '2026-03-31'],
    ['2026-04-30', '2026-04-01', '2026-06-30'],
    ['2026-12-31', '2026-10-01', '2026-12-31'],
  ])('maps %s to the quarter %s..%s', (day, from, to) => {
    const period = billingPeriodFor(Day.parse(day), 'QUARTERLY');

    expect(period.from.toString()).toBe(from);
    expect(period.to.toString()).toBe(to);
  });
});
