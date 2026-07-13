import { InvalidPhoneNumberError, RateLimitExceededError } from '../../domain/errors/auth.errors';
import { Argon2SecretHasher } from '../../infrastructure/crypto/argon2-secret.hasher';
import { RequestOtpUseCase } from './request-otp.use-case';
import {
  FakeClock,
  FakeOtpChallengeRepository,
  FakeOtpCodeGenerator,
  FakeRateLimiter,
  FakeSecretHasher,
  FakeSmsProvider,
  testAuthConfig,
} from './__fixtures__/auth.fakes';

function setup() {
  const challenges = new FakeOtpChallengeRepository();
  const codeGenerator = new FakeOtpCodeGenerator('654321');
  const hasher = new FakeSecretHasher();
  const sms = new FakeSmsProvider();
  const rateLimiter = new FakeRateLimiter();
  const clock = new FakeClock();

  const useCase = new RequestOtpUseCase(
    challenges,
    codeGenerator,
    hasher,
    sms,
    rateLimiter,
    clock,
    testAuthConfig,
  );

  return { useCase, challenges, codeGenerator, hasher, sms, rateLimiter, clock };
}

describe('RequestOtpUseCase', () => {
  it('normalises the phone number to E.164 before storing it', async () => {
    const { useCase, challenges } = setup();

    await useCase.execute({ phone: '9876543210', ip: '1.2.3.4' });

    expect(challenges.rows[0]?.phone).toBe('+919876543210');
  });

  it('sends the code by SMS and stores only its hash', async () => {
    const { useCase, challenges, sms } = setup();

    await useCase.execute({ phone: '+919876543210', ip: null });

    // The plaintext goes to the user...
    expect(sms.sent[0]?.body).toContain('654321');
    // ...and only a hash goes to the database.
    expect(challenges.rows[0]?.codeHash).toBe('hashed:654321');
  });

  /**
   * Run against the REAL Argon2 hasher, because the fake is intentionally reversible
   * so other tests can assert on it. "The plaintext code never reaches the database"
   * is a security property, and it is only meaningful against the hasher we ship.
   */
  it('stores a code that is unrecoverable from the database row', async () => {
    const challenges = new FakeOtpChallengeRepository();
    const useCase = new RequestOtpUseCase(
      challenges,
      new FakeOtpCodeGenerator('654321'),
      new Argon2SecretHasher(),
      new FakeSmsProvider(),
      new FakeRateLimiter(),
      new FakeClock(),
      testAuthConfig,
    );

    await useCase.execute({ phone: '+919876543210', ip: null });

    const stored = challenges.rows[0]?.codeHash ?? '';

    expect(stored).toContain('$argon2id$');
    expect(stored).not.toContain('654321');
  });

  it('sets the expiry exactly OTP_TTL_SECONDS ahead of now', async () => {
    const { useCase, challenges, clock } = setup();

    await useCase.execute({ phone: '+919876543210', ip: null });

    const expected = new Date(clock.now().getTime() + testAuthConfig.otpTtlSeconds * 1000);
    expect(challenges.rows[0]?.expiresAt).toEqual(expected);
  });

  it('rejects a malformed number before touching the rate limiter', async () => {
    const { useCase, rateLimiter } = setup();

    await expect(useCase.execute({ phone: 'not-a-number', ip: '1.2.3.4' })).rejects.toThrow(
      InvalidPhoneNumberError,
    );

    // Otherwise an attacker could exhaust a victim's budget with garbage input that
    // never even reaches the SMS provider.
    expect(rateLimiter.counters.size).toBe(0);
  });

  it('invalidates the previous outstanding challenge when a new code is requested', async () => {
    const { useCase, challenges, clock } = setup();

    await useCase.execute({ phone: '+919876543210', ip: null });
    clock.advanceSeconds(10);
    await useCase.execute({ phone: '+919876543210', ip: null });

    // Leaving the first code live would mean two valid codes in flight at once, and
    // the user reasonably expects the old one to stop working.
    const first = challenges.rows[0];
    expect(first?.expiresAt).toEqual(clock.now());
    expect(challenges.rows).toHaveLength(2);
  });

  describe('rate limiting', () => {
    it('limits per phone number', async () => {
      const { useCase, rateLimiter } = setup();
      rateLimiter.forcedDenials.add('otp:phone:+919876543210');

      await expect(useCase.execute({ phone: '+919876543210', ip: '1.2.3.4' })).rejects.toThrow(
        RateLimitExceededError,
      );
    });

    it('limits per IP as well, so rotating phone numbers does not evade it', async () => {
      const { useCase, rateLimiter } = setup();
      rateLimiter.forcedDenials.add('otp:ip:9.9.9.9');

      await expect(useCase.execute({ phone: '+919876543210', ip: '9.9.9.9' })).rejects.toThrow(
        RateLimitExceededError,
      );
    });

    it('checks the phone budget BEFORE the IP budget', async () => {
      const { useCase, rateLimiter } = setup();
      rateLimiter.forcedDenials.add('otp:phone:+919876543210');

      await expect(useCase.execute({ phone: '+919876543210', ip: '9.9.9.9' })).rejects.toThrow(
        RateLimitExceededError,
      );

      // An attacker rotating IPs must still not be able to SMS-bomb one victim, so the
      // phone budget has to be the first gate.
      expect(rateLimiter.counters.has('otp:ip:9.9.9.9')).toBe(false);
    });

    it('surfaces the retry-after window on the error', async () => {
      const { useCase, rateLimiter } = setup();
      rateLimiter.forcedDenials.add('otp:phone:+919876543210');

      await expect(useCase.execute({ phone: '+919876543210', ip: null })).rejects.toMatchObject({
        retryAfterSeconds: testAuthConfig.otpPhoneWindowSeconds,
      });
    });

    it('does not persist a challenge when the request is rate limited', async () => {
      const { useCase, challenges, rateLimiter } = setup();
      rateLimiter.forcedDenials.add('otp:phone:+919876543210');

      await expect(useCase.execute({ phone: '+919876543210', ip: null })).rejects.toThrow();

      expect(challenges.rows).toHaveLength(0);
    });
  });

  describe('when the SMS provider fails', () => {
    it('refunds the phone budget but NOT the IP budget', async () => {
      const { useCase, sms, rateLimiter } = setup();
      sms.shouldFail = true;

      await expect(useCase.execute({ phone: '+919876543210', ip: '1.2.3.4' })).rejects.toThrow(
        'SMS gateway unavailable',
      );

      // The user received nothing, so making them wait an hour would punish them for
      // our outage...
      expect(rateLimiter.resets).toContain('otp:phone:+919876543210');
      // ...but an attacker who can induce send failures must not earn free retries.
      expect(rateLimiter.resets).not.toContain('otp:ip:1.2.3.4');
    });
  });
});
