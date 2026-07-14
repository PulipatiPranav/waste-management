import { Day } from './day';
import { countIssues, isDeliveryDay } from './delivery-frequency';

describe('Day', () => {
  it('rejects a date that does not exist instead of rolling it over', () => {
    // `new Date(2026, 1, 30)` silently becomes 2 March. A start date of "30 February"
    // must be an error, not a subscription that quietly begins on the wrong day.
    expect(() => Day.of(2026, 2, 30)).toThrow(RangeError);
    expect(() => Day.parse('2026-02-30')).toThrow(RangeError);
    expect(() => Day.of(2026, 13, 1)).toThrow(RangeError);
  });

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(Day.parse('2028-02-29').toString()).toBe('2028-02-29');
    expect(() => Day.parse('2026-02-29')).toThrow(RangeError);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => Day.parse('14/07/2026')).toThrow(RangeError);
    expect(() => Day.parse('2026-7-1')).toThrow(RangeError);
    expect(() => Day.parse('2026-07-01T00:00:00Z')).toThrow(RangeError);
  });

  it('is timezone-independent', () => {
    // The bug this class exists to prevent: an instant is one day in Bengaluru and the
    // previous day in London, so "is the 17th billable?" would depend on the reader.
    const day = Day.parse('2026-07-17');

    expect(day.toUtcDate().toISOString()).toBe('2026-07-17T00:00:00.000Z');
    expect(Day.fromUtcDate(day.toUtcDate()).equals(day)).toBe(true);
  });

  describe('endOfMonth', () => {
    it.each([
      ['2026-07-05', '2026-07-31'],
      ['2026-02-10', '2026-02-28'],
      ['2028-02-01', '2028-02-29'],
      ['2026-04-30', '2026-04-30'],
    ])('%s -> %s', (input, expected) => {
      expect(Day.parse(input).endOfMonth().toString()).toBe(expected);
    });
  });

  describe('addMonths clamps rather than overflowing', () => {
    it('31 Jan + 1 month is 28 Feb, not 3 March', () => {
      expect(Day.parse('2026-01-31').addMonths(1).toString()).toBe('2026-02-28');
    });

    it('31 Jan + 1 month is 29 Feb in a leap year', () => {
      expect(Day.parse('2028-01-31').addMonths(1).toString()).toBe('2028-02-29');
    });

    it('crosses a year boundary', () => {
      expect(Day.parse('2026-11-15').addMonths(2).toString()).toBe('2027-01-15');
    });
  });

  it('crosses month and year boundaries when adding days', () => {
    expect(Day.parse('2026-12-31').addDays(1).toString()).toBe('2027-01-01');
    expect(Day.parse('2026-01-01').addDays(-1).toString()).toBe('2025-12-31');
    expect(Day.parse('2028-02-28').addDays(1).toString()).toBe('2028-02-29');
  });
});

describe('delivery frequency', () => {
  // 2026-07-05 is a Sunday; 2026-07-06 a Monday; 2026-07-11 a Saturday.
  it('knows which days carry an issue', () => {
    const sunday = Day.parse('2026-07-05');
    const monday = Day.parse('2026-07-06');
    const saturday = Day.parse('2026-07-11');

    expect(isDeliveryDay('DAILY', sunday)).toBe(true);
    expect(isDeliveryDay('WEEKDAYS', sunday)).toBe(false);
    expect(isDeliveryDay('WEEKDAYS', monday)).toBe(true);
    expect(isDeliveryDay('WEEKDAYS', saturday)).toBe(false);
    expect(isDeliveryDay('WEEKENDS', saturday)).toBe(true);
    expect(isDeliveryDay('WEEKENDS', sunday)).toBe(true);
    expect(isDeliveryDay('SUNDAY_ONLY', sunday)).toBe(true);
    expect(isDeliveryDay('SUNDAY_ONLY', saturday)).toBe(false);
  });

  describe('countIssues', () => {
    it('counts BOTH ends of the range', () => {
      // The inclusivity that the whole billing path rests on.
      const day = Day.parse('2026-07-17');

      expect(countIssues('DAILY', day, day)).toBe(1);
      expect(countIssues('DAILY', Day.parse('2026-07-01'), Day.parse('2026-07-31'))).toBe(31);
    });

    it('returns 0 for an inverted range rather than a negative count', () => {
      // A negative issue count would flow into a bill as a credit.
      expect(countIssues('DAILY', Day.parse('2026-07-31'), Day.parse('2026-07-01'))).toBe(0);
    });

    it('counts the weekdays and weekend days of July 2026', () => {
      const from = Day.parse('2026-07-01');
      const to = Day.parse('2026-07-31');

      const weekdays = countIssues('WEEKDAYS', from, to);
      const weekends = countIssues('WEEKENDS', from, to);

      expect(weekdays).toBe(23);
      expect(weekends).toBe(8);
      // Every day is exactly one or the other — the two partitions must tile the month.
      expect(weekdays + weekends).toBe(31);
    });
  });
});
