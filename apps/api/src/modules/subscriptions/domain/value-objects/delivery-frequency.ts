import { type Day } from './day';

/** Mirrors the Prisma enum. The domain must not import @prisma/client (ESLint enforces it). */
export const DELIVERY_FREQUENCIES = ['DAILY', 'WEEKDAYS', 'WEEKENDS', 'SUNDAY_ONLY'] as const;

export type DeliveryFrequency = (typeof DELIVERY_FREQUENCIES)[number];

const SUNDAY = 0;
const SATURDAY = 6;

/** Is an issue delivered on this day, for this frequency? */
export function isDeliveryDay(frequency: DeliveryFrequency, day: Day): boolean {
  const weekday = day.weekday;

  switch (frequency) {
    case 'DAILY':
      return true;
    case 'WEEKDAYS':
      return weekday !== SUNDAY && weekday !== SATURDAY;
    case 'WEEKENDS':
      return weekday === SUNDAY || weekday === SATURDAY;
    case 'SUNDAY_ONLY':
      return weekday === SUNDAY;
  }
}

/**
 * Issues delivered in [from, to], BOTH ENDS INCLUSIVE.
 *
 * Inclusivity is stated here, once, because it is the single most likely source of an
 * off-by-one in the whole billing path. A customer who subscribes on the 1st and
 * cancels on the 31st of a 31-day month receives 31 issues, not 30 — and the `<=` in
 * the loop below is the only thing that makes that true.
 *
 * Returns 0 when `to` is before `from` (an empty window), rather than a negative count.
 * A negative issue count would flow straight into a bill as a credit.
 */
export function countIssues(frequency: DeliveryFrequency, from: Day, to: Day): number {
  if (to.isBefore(from)) return 0;

  let count = 0;

  for (let cursor = from; cursor.isOnOrBefore(to); cursor = cursor.addDays(1)) {
    if (isDeliveryDay(frequency, cursor)) count += 1;
  }

  return count;
}
