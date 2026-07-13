import {
  AccountSuspendedError,
  InvalidOtpError,
  OtpAttemptsExceededError,
} from '../../domain/errors/auth.errors';
import { SessionIssuerService } from '../services/session-issuer.service';
import { VerifyOtpUseCase } from './verify-otp.use-case';
import {
  FakeClock,
  FakeOtpChallengeRepository,
  FakeRefreshTokenRepository,
  FakeSecretHasher,
  FakeTokenHasher,
  FakeTokenIssuer,
  FakeUserRepository,
  testAuthConfig,
} from './__fixtures__/auth.fakes';

const PHONE = '+919876543210';
const CODE = '654321';
const CONTEXT = { userAgent: 'jest', ip: '1.2.3.4' };

function setup() {
  const challenges = new FakeOtpChallengeRepository(testAuthConfig.otpMaxAttempts);
  const users = new FakeUserRepository();
  const hasher = new FakeSecretHasher();
  const clock = new FakeClock();
  const refreshTokens = new FakeRefreshTokenRepository();

  const sessionIssuer = new SessionIssuerService(
    refreshTokens,
    new FakeTokenIssuer(),
    new FakeTokenHasher(),
    clock,
    testAuthConfig,
  );

  const useCase = new VerifyOtpUseCase(
    challenges,
    users,
    hasher,
    clock,
    testAuthConfig,
    sessionIssuer,
  );

  /** Puts a live challenge for CODE in the repository. */
  const issueChallenge = async (phone = PHONE) =>
    challenges.create({
      phone,
      codeHash: await hasher.hash(CODE),
      expiresAt: new Date(clock.now().getTime() + testAuthConfig.otpTtlSeconds * 1000),
      requestIp: null,
    });

  return { useCase, challenges, users, clock, refreshTokens, issueChallenge };
}

describe('VerifyOtpUseCase', () => {
  it('issues a session for a correct code and registers the user', async () => {
    const { useCase, issueChallenge, users } = setup();
    await issueChallenge();

    const result = await useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT });

    expect(result.isNewUser).toBe(true);
    expect(result.tokenType).toBe('Bearer');
    expect(result.accessToken).toContain('CUSTOMER');
    expect(result.refreshToken).toBeTruthy();
    expect(users.users).toHaveLength(1);
  });

  it('logs an existing user in without creating a second account', async () => {
    const { useCase, issueChallenge, users } = setup();
    users.seed({ phone: PHONE, name: 'Priya' });
    await issueChallenge();

    const result = await useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT });

    expect(result.isNewUser).toBe(false);
    expect(users.users).toHaveLength(1);
  });

  it('accepts a non-normalised phone number, matching the challenge issued for E.164', async () => {
    const { useCase, issueChallenge } = setup();
    await issueChallenge();

    // The user typed it differently on the verify screen than on the request screen.
    await expect(
      useCase.execute({ phone: '09876543210', code: CODE, context: CONTEXT }),
    ).resolves.toBeDefined();
  });

  describe('single use', () => {
    it('refuses the same code a second time', async () => {
      const { useCase, issueChallenge } = setup();
      await issueChallenge();

      await useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT });

      // A captured code must be worthless the moment it has been spent.
      await expect(useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT })).rejects.toThrow(
        InvalidOtpError,
      );
    });

    it('lets exactly one of two concurrent verifications win', async () => {
      const { useCase, issueChallenge, refreshTokens } = setup();
      await issueChallenge();

      const results = await Promise.allSettled([
        useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT }),
        useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT }),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');

      // This is what the conditional `consume` UPDATE buys: a read-then-write would
      // let BOTH requests pass isConsumed() and mint two sessions from one code.
      expect(fulfilled).toHaveLength(1);
      expect(refreshTokens.rows).toHaveLength(1);
    });
  });

  describe('expiry', () => {
    it('refuses a code after the 5-minute window', async () => {
      const { useCase, issueChallenge, clock } = setup();
      await issueChallenge();

      clock.advanceSeconds(testAuthConfig.otpTtlSeconds);

      await expect(useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT })).rejects.toThrow(
        InvalidOtpError,
      );
    });

    it('accepts a code one second before expiry', async () => {
      const { useCase, issueChallenge, clock } = setup();
      await issueChallenge();

      clock.advanceSeconds(testAuthConfig.otpTtlSeconds - 1);

      await expect(
        useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT }),
      ).resolves.toBeDefined();
    });
  });

  describe('wrong codes', () => {
    it('increments the attempt counter', async () => {
      const { useCase, issueChallenge, challenges } = setup();
      await issueChallenge();

      await expect(
        useCase.execute({ phone: PHONE, code: '000000', context: CONTEXT }),
      ).rejects.toThrow(InvalidOtpError);

      // If the counter did not move, the attempt cap would be decorative and the code
      // could be walked exhaustively.
      expect(challenges.rows[0]?.attempts).toBe(1);
    });

    it('kills the challenge once the attempt cap is reached', async () => {
      const { useCase, issueChallenge } = setup();
      await issueChallenge();

      for (let i = 0; i < testAuthConfig.otpMaxAttempts; i += 1) {
        await expect(
          useCase.execute({ phone: PHONE, code: '000000', context: CONTEXT }),
        ).rejects.toThrow(InvalidOtpError);
      }

      // Even the CORRECT code is now refused — the challenge is spent, not just locked.
      await expect(useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT })).rejects.toThrow(
        OtpAttemptsExceededError,
      );
    });

    it('gives the same error whether or not a challenge exists', async () => {
      const { useCase } = setup();

      // No challenge at all for this number. Distinguishing this case would tell an
      // attacker which numbers currently have a login in flight.
      await expect(
        useCase.execute({ phone: PHONE, code: '000000', context: CONTEXT }),
      ).rejects.toThrow(InvalidOtpError);
    });
  });

  it('refuses a suspended account even with the correct code', async () => {
    const { useCase, issueChallenge, users } = setup();
    users.seed({ phone: PHONE, isActive: false });
    await issueChallenge();

    await expect(useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT })).rejects.toThrow(
      AccountSuspendedError,
    );
  });

  it('burns the challenge even when the account is suspended', async () => {
    const { useCase, issueChallenge, users, challenges } = setup();
    users.seed({ phone: PHONE, isActive: false });
    await issueChallenge();

    await expect(useCase.execute({ phone: PHONE, code: CODE, context: CONTEXT })).rejects.toThrow();

    // Consuming before the isActive check means a suspended user cannot use the
    // endpoint as an oracle for "is this number registered?" by comparing which codes
    // remain reusable.
    expect(challenges.rows[0]?.consumedAt).not.toBeNull();
  });
});
