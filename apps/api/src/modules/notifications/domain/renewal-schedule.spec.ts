import {
  daysBetween,
  daysUntilRenewal,
  isRenewalReminderDue,
  nextRenewalOnOrAfter,
} from './renewal-schedule';

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('nextRenewalOnOrAfter', () => {
  it('finds the next monthly anniversary on or after a date', () => {
    // Started Jan 10; on Mar 5 the next renewal is Mar 10.
    expect(nextRenewalOnOrAfter(utc('2026-01-10'), 'MONTHLY', utc('2026-03-05'))).toEqual(
      utc('2026-03-10'),
    );
  });

  it('returns the same day when the date IS a renewal', () => {
    expect(nextRenewalOnOrAfter(utc('2026-01-10'), 'MONTHLY', utc('2026-04-10'))).toEqual(
      utc('2026-04-10'),
    );
  });

  it('steps by three months for quarterly', () => {
    expect(nextRenewalOnOrAfter(utc('2026-01-15'), 'QUARTERLY', utc('2026-02-01'))).toEqual(
      utc('2026-04-15'),
    );
  });

  it('clamps a 31st start into short months rather than rolling over', () => {
    // Jan 31 monthly: the Feb renewal clamps to Feb 28, not Mar 3.
    expect(nextRenewalOnOrAfter(utc('2026-01-31'), 'MONTHLY', utc('2026-02-01'))).toEqual(
      utc('2026-02-28'),
    );
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween(utc('2026-07-01'), utc('2026-07-04'))).toBe(3);
    expect(daysBetween(utc('2026-07-04'), utc('2026-07-01'))).toBe(-3);
  });
});

describe('isRenewalReminderDue', () => {
  it('fires exactly leadDays before renewal', () => {
    // Renews Aug 10; on Aug 7 with lead 3 it is due.
    expect(isRenewalReminderDue(utc('2026-01-10'), 'MONTHLY', utc('2026-08-07'), 3)).toBe(true);
  });

  it('does NOT fire on the other days in the lead window (fires once, not every day)', () => {
    expect(isRenewalReminderDue(utc('2026-01-10'), 'MONTHLY', utc('2026-08-08'), 3)).toBe(false);
    expect(isRenewalReminderDue(utc('2026-01-10'), 'MONTHLY', utc('2026-08-09'), 3)).toBe(false);
    expect(isRenewalReminderDue(utc('2026-01-10'), 'MONTHLY', utc('2026-08-06'), 3)).toBe(false);
  });

  it('daysUntilRenewal is 0 on the renewal day', () => {
    expect(daysUntilRenewal(utc('2026-01-10'), 'MONTHLY', utc('2026-09-10'))).toBe(0);
  });
});
