import { AccountSuspendedError, InvalidRefreshTokenError } from '../../domain/errors/auth.errors';
import { SessionIssuerService } from '../services/session-issuer.service';
import { RefreshTokensUseCase } from './refresh-tokens.use-case';
import {
  FakeClock,
  FakeRefreshTokenRepository,
  FakeTokenHasher,
  FakeTokenIssuer,
  FakeUserRepository,
  testAuthConfig,
} from './__fixtures__/auth.fakes';

const CONTEXT = { userAgent: 'jest', ip: '1.2.3.4' };

function setup() {
  const refreshTokens = new FakeRefreshTokenRepository();
  const users = new FakeUserRepository();
  const tokenHasher = new FakeTokenHasher();
  const clock = new FakeClock();

  const sessionIssuer = new SessionIssuerService(
    refreshTokens,
    new FakeTokenIssuer(),
    tokenHasher,
    clock,
    testAuthConfig,
  );

  const useCase = new RefreshTokensUseCase(refreshTokens, users, tokenHasher, clock, sessionIssuer);

  const user = users.seed({ phone: '+919876543210' });

  /** Simulates a fresh login: issues the first token of a new family. */
  const login = async () => sessionIssuer.issueForUser(user, CONTEXT);

  return { useCase, refreshTokens, users, clock, user, login, sessionIssuer };
}

describe('RefreshTokensUseCase', () => {
  describe('rotation', () => {
    it('returns a NEW refresh token, not the one presented', async () => {
      const { useCase, login } = setup();
      const session = await login();

      const refreshed = await useCase.execute({
        refreshToken: session.refreshToken,
        context: CONTEXT,
      });

      expect(refreshed.refreshToken).not.toBe(session.refreshToken);
      expect(refreshed.accessToken).toBeTruthy();
    });

    it('revokes the presented token as part of the exchange', async () => {
      const { useCase, refreshTokens, login } = setup();
      const session = await login();

      await useCase.execute({ refreshToken: session.refreshToken, context: CONTEXT });

      const old = refreshTokens.rows[0];
      expect(old?.revokedAt).not.toBeNull();
    });

    it('keeps the replacement in the SAME family', async () => {
      const { useCase, refreshTokens, login } = setup();
      const session = await login();

      await useCase.execute({ refreshToken: session.refreshToken, context: CONTEXT });

      // The shared family id is what makes reuse detectable at all — lose it and a
      // stolen token can only ever revoke itself.
      expect(refreshTokens.rows[1]?.family).toBe(refreshTokens.rows[0]?.family);
    });

    it('allows a chain of rotations', async () => {
      const { useCase, login } = setup();
      let token = (await login()).refreshToken;

      for (let i = 0; i < 3; i += 1) {
        const next = await useCase.execute({ refreshToken: token, context: CONTEXT });
        token = next.refreshToken;
      }

      await expect(
        useCase.execute({ refreshToken: token, context: CONTEXT }),
      ).resolves.toBeDefined();
    });
  });

  describe('reuse detection', () => {
    it('rejects a token that was already rotated away', async () => {
      const { useCase, login } = setup();
      const session = await login();

      await useCase.execute({ refreshToken: session.refreshToken, context: CONTEXT });

      await expect(
        useCase.execute({ refreshToken: session.refreshToken, context: CONTEXT }),
      ).rejects.toThrow(InvalidRefreshTokenError);
    });

    it('revokes the ENTIRE family when a spent token is replayed', async () => {
      const { useCase, refreshTokens, login } = setup();
      const session = await login();

      const rotated = await useCase.execute({
        refreshToken: session.refreshToken,
        context: CONTEXT,
      });

      // The attacker replays the stolen, already-spent token.
      await expect(
        useCase.execute({ refreshToken: session.refreshToken, context: CONTEXT }),
      ).rejects.toThrow();

      // The legitimate user's CURRENT token must now be dead too. We cannot tell
      // victim from thief, so both are forced back through login — which the thief
      // cannot pass, because they do not have the phone.
      await expect(
        useCase.execute({ refreshToken: rotated.refreshToken, context: CONTEXT }),
      ).rejects.toThrow(InvalidRefreshTokenError);

      expect(refreshTokens.rows.every((row) => row.revokedAt !== null)).toBe(true);
    });

    it('does not touch other login sessions of the same user', async () => {
      const { useCase, login } = setup();

      const phone = await login(); // e.g. the phone
      const tablet = await login(); // a second device: a different family

      await useCase.execute({ refreshToken: phone.refreshToken, context: CONTEXT });
      await expect(
        useCase.execute({ refreshToken: phone.refreshToken, context: CONTEXT }),
      ).rejects.toThrow();

      // Compromise of one device must not sign the user out everywhere — that is why
      // revocation is scoped to the family and not to the user.
      await expect(
        useCase.execute({ refreshToken: tablet.refreshToken, context: CONTEXT }),
      ).resolves.toBeDefined();
    });
  });

  describe('rejections', () => {
    it('rejects an unknown token', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({ refreshToken: 'never-issued', context: CONTEXT }),
      ).rejects.toThrow(InvalidRefreshTokenError);
    });

    it('rejects an expired token', async () => {
      const { useCase, clock, login } = setup();
      const session = await login();

      clock.advanceSeconds(testAuthConfig.refreshTokenTtlSeconds);

      await expect(
        useCase.execute({ refreshToken: session.refreshToken, context: CONTEXT }),
      ).rejects.toThrow(InvalidRefreshTokenError);
    });

    it('rejects a suspended user and kills their family', async () => {
      const { useCase, users, login, refreshTokens } = setup();
      const session = await login();

      // The user is suspended by an admin mid-session.
      users.users.length = 0;
      users.seed({ id: refreshTokens.rows[0]?.userId, phone: '+919876543210', isActive: false });

      await expect(
        useCase.execute({ refreshToken: session.refreshToken, context: CONTEXT }),
      ).rejects.toThrow(AccountSuspendedError);

      // Suspension must take effect no later than the next refresh, rather than
      // whenever the access token happens to lapse.
      expect(refreshTokens.rows.every((row) => row.revokedAt !== null)).toBe(true);
    });
  });
});
