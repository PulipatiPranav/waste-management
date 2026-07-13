import { OtpChallenge } from './otp-challenge';

const build = (overrides: Partial<Parameters<typeof OtpChallenge.fromPersistence>[0]> = {}) =>
  OtpChallenge.fromPersistence({
    id: 'challenge-1',
    phone: '+919876543210',
    codeHash: 'hashed',
    expiresAt: new Date('2026-01-01T00:05:00Z'),
    consumedAt: null,
    attempts: 0,
    maxAttempts: 5,
    ...overrides,
  });

const AT_ISSUE = new Date('2026-01-01T00:00:00Z');

describe('OtpChallenge', () => {
  describe('expiry', () => {
    it('is usable one second before it expires', () => {
      const challenge = build();
      expect(challenge.checkUsable(new Date('2026-01-01T00:04:59Z'))).toBeNull();
    });

    // The boundary is the bug people actually ship. A `<` here instead of `<=` leaves
    // the code valid for one extra tick at exactly the expiry instant.
    it('is expired AT the expiry instant, not one tick after', () => {
      const challenge = build();
      expect(challenge.isExpired(new Date('2026-01-01T00:05:00Z'))).toBe(true);
      expect(challenge.checkUsable(new Date('2026-01-01T00:05:00Z'))).toBe('expired');
    });

    it('is expired after the expiry instant', () => {
      expect(build().checkUsable(new Date('2026-01-01T00:05:01Z'))).toBe('expired');
    });

    it('honours the 5-minute window the brief specifies', () => {
      const fiveMinutes = 5 * 60 * 1000;
      const challenge = build({ expiresAt: new Date(AT_ISSUE.getTime() + fiveMinutes) });

      expect(challenge.isExpired(new Date(AT_ISSUE.getTime() + fiveMinutes - 1))).toBe(false);
      expect(challenge.isExpired(new Date(AT_ISSUE.getTime() + fiveMinutes))).toBe(true);
    });
  });

  describe('single use', () => {
    it('refuses a consumed challenge even while it is still unexpired', () => {
      const challenge = build({ consumedAt: new Date('2026-01-01T00:01:00Z') });

      // Unexpired...
      expect(challenge.isExpired(AT_ISSUE)).toBe(false);
      // ...but spent. Both conditions must hold for a code to be replayable, and this
      // is the one that stops a captured code being used twice.
      expect(challenge.checkUsable(AT_ISSUE)).toBe('consumed');
    });

    it('reports consumed ahead of expired when a spent code is also stale', () => {
      const challenge = build({ consumedAt: AT_ISSUE });
      expect(challenge.checkUsable(new Date('2026-01-01T09:00:00Z'))).toBe('consumed');
    });
  });

  describe('attempt cap', () => {
    it('allows attempts below the maximum', () => {
      expect(build({ attempts: 4, maxAttempts: 5 }).checkUsable(AT_ISSUE)).toBeNull();
    });

    // Without this cap a 6-digit code is only 10^6 guesses; the cap is what makes an
    // online brute force hopeless regardless of how the rate limiter is tuned.
    it('is dead once attempts reach the maximum', () => {
      expect(build({ attempts: 5, maxAttempts: 5 }).checkUsable(AT_ISSUE)).toBe(
        'attempts_exceeded',
      );
    });

    it('stays dead if attempts somehow exceed the maximum', () => {
      expect(build({ attempts: 9, maxAttempts: 5 }).checkUsable(AT_ISSUE)).toBe(
        'attempts_exceeded',
      );
    });
  });
});
