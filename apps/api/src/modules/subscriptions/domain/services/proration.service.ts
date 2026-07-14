import { Day } from '../value-objects/day';
import { countIssues, type DeliveryFrequency } from '../value-objects/delivery-frequency';

/** A closed pause window, or an open one (`resumedFrom === null`). */
export interface PauseWindow {
  /** Inclusive: no issue is delivered on this day. */
  pausedFrom: Day;
  /** Inclusive: the first day delivery resumes. Null = still paused. */
  resumedFrom: Day | null;
}

export interface BillingPeriod {
  from: Day;
  to: Day;
}

export interface ProrationInput {
  period: BillingPeriod;
  frequency: DeliveryFrequency;
  pricePerIssuePaise: number;

  /** The subscription's first day. Issues before it are not billable. */
  startDate: Day;

  /** The last billable day. Null while the subscription is live. */
  cancelledOn: Day | null;

  pauses: readonly PauseWindow[];
}

export interface ProrationResult {
  /** Issues actually delivered in this period, after start, cancellation and pauses. */
  billableIssues: number;

  /** Issues the customer would have received had they been active all period. */
  fullPeriodIssues: number;

  /** Issues NOT delivered because of pauses. Shown on the invoice, so the credit is visible. */
  pausedIssues: number;

  amountPaise: number;

  /** True when the customer is being charged less than a full period. */
  isProrated: boolean;
}

/**
 * Works out what to charge for one billing period.
 *
 * The whole design rests on one decision: **a newspaper is priced per ISSUE, not per
 * month.** So proration is not a division — it is a count.
 *
 *     amount = pricePerIssue × (issues actually delivered)
 *
 * The alternative, `monthlyPrice × daysActive / daysInMonth`, is where every billing
 * bug in this class of system comes from: it needs a rounding rule, that rule has to
 * be applied consistently across start/pause/cancel, February and 31-day months
 * disagree, and the rounded parts of a split month do not add back up to the whole.
 * Counting issues has none of those problems. 450 paise × 26 issues = 11700 paise,
 * exactly, on any calendar, with no rounding step to get wrong.
 *
 * Everything here is pure: no clock, no database. That is what makes the boundary
 * cases (subscribe on the last day of the month, pause and resume on the same day,
 * cancel on day one) testable as arithmetic rather than as fixtures.
 */
export function calculateProration(input: ProrationInput): ProrationResult {
  const { period, frequency, pricePerIssuePaise, startDate, cancelledOn, pauses } = input;

  const fullPeriodIssues = countIssues(frequency, period.from, period.to);

  // Clip the period to the subscription's own lifetime. A subscription that started on
  // the 17th is not billed for the 1st-16th, and one cancelled on the 20th is not
  // billed for the 21st onward.
  const chargeableFrom = Day.max(period.from, startDate);
  const chargeableTo = cancelledOn === null ? period.to : Day.min(period.to, cancelledOn);

  // The subscription was not live at any point in this period (starts later, or ended
  // earlier). Not an error — just a zero invoice.
  if (chargeableTo.isBefore(chargeableFrom)) {
    return {
      billableIssues: 0,
      fullPeriodIssues,
      pausedIssues: 0,
      amountPaise: 0,
      isProrated: true,
    };
  }

  const issuesInWindow = countIssues(frequency, chargeableFrom, chargeableTo);

  // Subtract issues missed while paused. Each pause window is intersected with the
  // chargeable window first, so a pause that began before the period (or extends past
  // the end of it) is only credited for the part that overlaps THIS period — otherwise
  // a long pause would be credited in full, in every month it touched.
  let pausedIssues = 0;

  for (const pause of pauses) {
    const pauseFrom = Day.max(pause.pausedFrom, chargeableFrom);

    // resumedFrom is the first day delivery RESUMES, so the last paused day is the day
    // before it. An open pause runs to the end of the chargeable window.
    const pauseTo =
      pause.resumedFrom === null
        ? chargeableTo
        : Day.min(pause.resumedFrom.addDays(-1), chargeableTo);

    // No overlap with this period.
    if (pauseTo.isBefore(pauseFrom)) continue;

    pausedIssues += countIssues(frequency, pauseFrom, pauseTo);
  }

  // Guard rather than trust: overlapping pause windows (which the DB's one-open-pause
  // index prevents, but a bad backfill could still create) would otherwise subtract the
  // same issue twice and produce a negative bill — i.e. pay the customer to read.
  const billableIssues = Math.max(0, issuesInWindow - pausedIssues);

  return {
    billableIssues,
    fullPeriodIssues,
    pausedIssues: Math.min(pausedIssues, issuesInWindow),
    amountPaise: billableIssues * pricePerIssuePaise,
    isProrated: billableIssues < fullPeriodIssues,
  };
}

/**
 * The billing period containing `day`.
 *
 * Calendar-aligned (a month starts on the 1st), not anniversary-aligned (a month
 * starts on the subscriber's join date). Calendar periods mean every customer's
 * invoice covers the same window, so the monthly delivery run, the vendor
 * reconciliation and the customer's bill all agree on what "July" means. Anniversary
 * cycles would give you as many billing calendars as you have customers.
 */
export function billingPeriodFor(day: Day, cycle: 'MONTHLY' | 'QUARTERLY'): BillingPeriod {
  if (cycle === 'MONTHLY') {
    return { from: day.startOfMonth(), to: day.endOfMonth() };
  }

  // Quarters are fixed: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec.
  const quarterStartMonth = Math.floor((day.month - 1) / 3) * 3 + 1;
  const from = Day.of(day.year, quarterStartMonth, 1);

  return { from, to: from.addMonths(2).endOfMonth() };
}
