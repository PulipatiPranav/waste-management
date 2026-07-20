/**
 * When does a subscription next renew, and how many days away is that? Pure date arithmetic, kept
 * out of the scheduler so the reminder rule can be tested without a clock or a database.
 *
 * The reminder fires when the count of days to the next renewal EXACTLY equals the configured lead
 * (e.g. 3). Firing on "<= lead" instead would re-send the reminder every day for the last three
 * days of every cycle — the fastest way to make a customer disable the whole category. Equality
 * means exactly one reminder per cycle, no dedup table required.
 */

export type BillingCycle = 'MONTHLY' | 'QUARTERLY';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days from `from` to `to` (both truncated to UTC midnight). Can be negative. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * The first renewal date on or after `from`, stepping from `startDate` by the cycle length.
 *
 * Renewal keeps the start day-of-month; a start on the 31st that lands in a short month is clamped
 * to that month's last day (JS Date rolls over otherwise, turning Jan 31 + 1mo into Mar 3). The
 * loop is bounded — cycles are at least a month, so it advances quickly to any realistic `from`.
 */
export function nextRenewalOnOrAfter(startDate: Date, cycle: BillingCycle, from: Date): Date {
  const step = cycle === 'QUARTERLY' ? 3 : 1;
  const day = startDate.getUTCDate();

  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();
  let candidate = clampedUtcDate(year, month, day);

  // Advance whole cycles until we reach or pass `from`.
  let guard = 0;
  while (candidate < atUtcMidnight(from) && guard < 10_000) {
    month += step;
    year += Math.floor(month / 12);
    month = ((month % 12) + 12) % 12;
    candidate = clampedUtcDate(year, month, day);
    guard += 1;
  }
  return candidate;
}

/** Days from `today` until the subscription's next renewal (0 = renews today). */
export function daysUntilRenewal(startDate: Date, cycle: BillingCycle, today: Date): number {
  return daysBetween(today, nextRenewalOnOrAfter(startDate, cycle, today));
}

/** True when the renewal is exactly `leadDays` away — the single moment the reminder fires. */
export function isRenewalReminderDue(
  startDate: Date,
  cycle: BillingCycle,
  today: Date,
  leadDays: number,
): boolean {
  return daysUntilRenewal(startDate, cycle, today) === leadDays;
}

function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A UTC date for (year, month, day), clamping day to the month's last day. */
function clampedUtcDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}
