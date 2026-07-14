/**
 * A calendar day, with no time and no timezone.
 *
 * Newspaper billing is a question about DAYS ("was an issue delivered on the 17th?"),
 * not about instants. Modelling a day as a `Date` invites the bug where
 * 2026-07-14T18:30:00Z is "the 14th" in London and "the 15th" in Bengaluru, so a
 * subscription's first billable day moves depending on who asks — and every boundary
 * test becomes a coin flip that passes in CI and fails in production.
 *
 * So: days are (year, month, day) triples, compared as integers. The only place a
 * `Date` appears is the conversion at the persistence edge, pinned to UTC midnight.
 */
export class Day {
  private constructor(
    readonly year: number,
    /** 1-12. Not the 0-11 that `Date.getMonth()` returns — that off-by-one is a classic. */
    readonly month: number,
    readonly day: number,
  ) {}

  static of(year: number, month: number, day: number): Day {
    const probe = new Date(Date.UTC(year, month - 1, day));

    // Rejects 2026-02-30 and friends: Date silently rolls them over to 2026-03-02,
    // which would make an invalid start date quietly become a valid, wrong one.
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      throw new RangeError(`Not a real date: ${year}-${month}-${day}`);
    }

    return new Day(year, month, day);
  }

  /** Parses `YYYY-MM-DD`, and only that. */
  static parse(iso: string): Day {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);

    if (match === null) {
      throw new RangeError(`Expected YYYY-MM-DD, got: ${iso}`);
    }

    return Day.of(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  /** From a `Date` that is already known to be UTC midnight (i.e. Postgres `date`). */
  static fromUtcDate(date: Date): Day {
    return Day.of(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  /** UTC midnight, which is what Postgres `date` round-trips as. */
  toUtcDate(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, this.day));
  }

  toString(): string {
    const mm = String(this.month).padStart(2, '0');
    const dd = String(this.day).padStart(2, '0');
    return `${this.year}-${mm}-${dd}`;
  }

  /** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`. */
  get weekday(): number {
    return this.toUtcDate().getUTCDay();
  }

  addDays(count: number): Day {
    const shifted = new Date(this.toUtcDate().getTime() + count * 86_400_000);
    return Day.fromUtcDate(shifted);
  }

  /** Ordinal for comparison. Days are totally ordered; this is the only comparison used. */
  private get ordinal(): number {
    return this.year * 10_000 + this.month * 100 + this.day;
  }

  isBefore(other: Day): boolean {
    return this.ordinal < other.ordinal;
  }

  isAfter(other: Day): boolean {
    return this.ordinal > other.ordinal;
  }

  equals(other: Day): boolean {
    return this.ordinal === other.ordinal;
  }

  isOnOrBefore(other: Day): boolean {
    return this.ordinal <= other.ordinal;
  }

  isOnOrAfter(other: Day): boolean {
    return this.ordinal >= other.ordinal;
  }

  static min(a: Day, b: Day): Day {
    return a.isBefore(b) ? a : b;
  }

  static max(a: Day, b: Day): Day {
    return a.isAfter(b) ? a : b;
  }

  /** Last day of this Day's month. Knows about February and leap years. */
  endOfMonth(): Day {
    // Day 0 of the NEXT month is the last day of this one — the standard trick, and
    // the reason this does not need a leap-year table.
    const last = new Date(Date.UTC(this.year, this.month, 0));
    return Day.fromUtcDate(last);
  }

  startOfMonth(): Day {
    return Day.of(this.year, this.month, 1);
  }

  addMonths(count: number): Day {
    const targetMonthIndex = this.month - 1 + count;
    const year = this.year + Math.floor(targetMonthIndex / 12);
    const month = ((targetMonthIndex % 12) + 12) % 12;

    // Clamp: 31 Jan + 1 month is 28 Feb, not 3 March. Date would roll it over.
    const lastOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    return Day.of(year, month + 1, Math.min(this.day, lastOfTarget));
  }
}
