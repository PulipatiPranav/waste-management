import { Argon2SecretHasher } from '../../infrastructure/crypto/argon2-secret.hasher';
import {
  AccountSuspendedError,
  InvalidCredentialsError,
  RateLimitExceededError,
} from '../../domain/errors/auth.errors';
import { SessionIssuerService } from '../services/session-issuer.service';
import { StaffLoginUseCase } from './staff-login.use-case';
import {
  FakeClock,
  FakeRateLimiter,
  FakeRefreshTokenRepository,
  FakeTokenHasher,
  FakeTokenIssuer,
  FakeUserRepository,
  testAuthConfig,
} from './__fixtures__/auth.fakes';

const PASSWORD = 'correct horse battery staple';
const CONTEXT = { userAgent: 'jest', ip: '1.2.3.4' };

/**
 * Uses the REAL Argon2 hasher, not a fake.
 *
 * The brief mandates argon2 over bcrypt, and a fake hasher would let that regress
 * silently — this test would still pass if someone swapped in MD5. It costs a few
 * hundred milliseconds and is worth every one of them.
 */
async function setup() {
  const users = new FakeUserRepository();
  const hasher = new Argon2SecretHasher();
  const rateLimiter = new FakeRateLimiter();
  const clock = new FakeClock();
  const refreshTokens = new FakeRefreshTokenRepository();

  const sessionIssuer = new SessionIssuerService(
    refreshTokens,
    new FakeTokenIssuer(),
    new FakeTokenHasher(),
    clock,
    testAuthConfig,
  );

  const useCase = new StaffLoginUseCase(users, hasher, rateLimiter, sessionIssuer);

  const passwordHash = await hasher.hash(PASSWORD);

  return { useCase, users, hasher, rateLimiter, passwordHash };
}

describe('StaffLoginUseCase', () => {
  it('produces an argon2id hash, not bcrypt', async () => {
    const { passwordHash } = await setup();

    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('signs in an OPS_STAFF user with the right password', async () => {
    const { useCase, users, passwordHash } = await setup();
    users.seed({
      phone: '+919000000001',
      email: 'ops@example.com',
      role: 'OPS_STAFF',
      passwordHash,
    });

    const session = await useCase.execute({
      email: 'ops@example.com',
      password: PASSWORD,
      context: CONTEXT,
    });

    expect(session.accessToken).toContain('OPS_STAFF');
  });

  it('normalises the email, so Ops@Example.COM works', async () => {
    const { useCase, users, passwordHash } = await setup();
    users.seed({
      phone: '+919000000001',
      email: 'ops@example.com',
      role: 'OPS_STAFF',
      passwordHash,
    });

    await expect(
      useCase.execute({ email: '  Ops@Example.COM ', password: PASSWORD, context: CONTEXT }),
    ).resolves.toBeDefined();
  });

  it('rejects a wrong password', async () => {
    const { useCase, users, passwordHash } = await setup();
    users.seed({
      phone: '+919000000001',
      email: 'ops@example.com',
      role: 'OPS_STAFF',
      passwordHash,
    });

    await expect(
      useCase.execute({ email: 'ops@example.com', password: 'wrong', context: CONTEXT }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('gives the same error for an unknown email as for a wrong password', async () => {
    const { useCase } = await setup();

    // Anything more specific turns this endpoint into a staff-email enumerator.
    await expect(
      useCase.execute({ email: 'nobody@example.com', password: PASSWORD, context: CONTEXT }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('refuses a CUSTOMER even if they somehow have a password set', async () => {
    const { useCase, users, passwordHash } = await setup();
    users.seed({
      phone: '+919000000002',
      email: 'customer@example.com',
      role: 'CUSTOMER',
      passwordHash,
    });

    // Password login is a staff-only door. A customer's account must not be reachable
    // through it even if a password hash somehow ends up on the row.
    await expect(
      useCase.execute({ email: 'customer@example.com', password: PASSWORD, context: CONTEXT }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('refuses a suspended staff account', async () => {
    const { useCase, users, passwordHash } = await setup();
    users.seed({
      phone: '+919000000003',
      email: 'ex@example.com',
      role: 'SUPER_ADMIN',
      passwordHash,
      isActive: false,
    });

    await expect(
      useCase.execute({ email: 'ex@example.com', password: PASSWORD, context: CONTEXT }),
    ).rejects.toThrow(AccountSuspendedError);
  });

  it('rate limits password guessing per email', async () => {
    const { useCase, rateLimiter } = await setup();
    rateLimiter.forcedDenials.add('login:email:ops@example.com');

    await expect(
      useCase.execute({ email: 'ops@example.com', password: PASSWORD, context: CONTEXT }),
    ).rejects.toThrow(RateLimitExceededError);
  });
});
