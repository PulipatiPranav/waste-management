import { randomUUID } from 'node:crypto';

import { type User } from '@/modules/users/domain/entities/user';
import { User as UserEntity } from '@/modules/users/domain/entities/user';
import {
  type UpdateUserProfileInput,
  type UserRepository,
} from '@/modules/users/domain/ports/user.repository';
import { OtpChallenge } from '../../../domain/entities/otp-challenge';
import { type Clock } from '../../../domain/ports/clock.port';
import { type SecretHasher, type TokenHasher } from '../../../domain/ports/hasher.port';
import {
  type CreateOtpChallengeInput,
  type OtpChallengeRepository,
} from '../../../domain/ports/otp-challenge.repository';
import { type OtpCodeGenerator } from '../../../domain/ports/otp-code-generator.port';
import { type RateLimitDecision, type RateLimiter } from '../../../domain/ports/rate-limiter.port';
import {
  type CreateRefreshTokenInput,
  type RefreshTokenRepository,
  type StoredRefreshToken,
} from '../../../domain/ports/refresh-token.repository';
import { type SendSmsCommand, type SmsProvider } from '../../../domain/ports/sms-provider.port';
import { type AccessTokenClaims, type TokenIssuer } from '../../../domain/ports/token-issuer.port';
import { type Role } from '../../../domain/value-objects/role';
import { type AuthConfig } from '../../auth.config';

/** Time under the test's control — the whole reason `Clock` is a port. */
export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-01-01T00:00:00Z')) {}

  now(): Date {
    return this.current;
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }

  set(date: Date): void {
    this.current = date;
  }
}

/** Reversible "hash" so tests can assert on what was hashed without running Argon2. */
export class FakeSecretHasher implements SecretHasher {
  hash(plaintext: string): Promise<string> {
    return Promise.resolve(`hashed:${plaintext}`);
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return Promise.resolve(hash === `hashed:${plaintext}`);
  }
}

export class FakeTokenHasher implements TokenHasher {
  hash(token: string): string {
    return `sha:${token}`;
  }
}

export class FakeOtpCodeGenerator implements OtpCodeGenerator {
  constructor(public nextCode = '123456') {}

  generate(length: number): string {
    return this.nextCode.slice(0, length);
  }
}

export class FakeSmsProvider implements SmsProvider {
  readonly sent: SendSmsCommand[] = [];
  shouldFail = false;

  send(command: SendSmsCommand): Promise<void> {
    if (this.shouldFail) {
      return Promise.reject(new Error('SMS gateway unavailable'));
    }

    this.sent.push(command);
    return Promise.resolve();
  }
}

export class FakeTokenIssuer implements TokenIssuer {
  private counter = 0;

  issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return Promise.resolve(`access:${claims.sub}:${claims.role}`);
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    const [, sub, role] = token.split(':');
    if (sub === undefined || role === undefined) return Promise.resolve(null);
    return Promise.resolve({ sub, role: role as Role });
  }

  generateRefreshToken(): string {
    this.counter += 1;
    return `refresh-token-${this.counter}`;
  }
}

export class FakeRateLimiter implements RateLimiter {
  readonly counters = new Map<string, number>();
  readonly resets: string[] = [];

  /** Force the next `consume` for a key to be denied, whatever the count. */
  readonly forcedDenials = new Set<string>();

  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const count = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, count);

    const allowed = !this.forcedDenials.has(key) && count <= limit;

    return Promise.resolve({
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed ? 0 : windowSeconds,
    });
  }

  reset(key: string): Promise<void> {
    this.resets.push(key);
    this.counters.delete(key);
    return Promise.resolve();
  }
}

interface ChallengeRow {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
}

export class FakeOtpChallengeRepository implements OtpChallengeRepository {
  readonly rows: ChallengeRow[] = [];

  constructor(private readonly maxAttempts = 5) {}

  create(input: CreateOtpChallengeInput): Promise<OtpChallenge> {
    const row: ChallengeRow = {
      id: randomUUID(),
      phone: input.phone,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
      attempts: 0,
    };

    this.rows.push(row);
    return Promise.resolve(this.toDomain(row));
  }

  findLatestByPhone(phone: string): Promise<OtpChallenge | null> {
    const matches = this.rows.filter((row) => row.phone === phone);
    const latest = matches.at(-1);
    return Promise.resolve(latest === undefined ? null : this.toDomain(latest));
  }

  incrementAttempts(id: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row !== undefined) row.attempts += 1;
    return Promise.resolve();
  }

  /** Mirrors the conditional UPDATE: consuming an already-consumed row returns false. */
  consume(id: string, consumedAt: Date): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);

    if (row?.consumedAt !== null || row === undefined) return Promise.resolve(false);

    row.consumedAt = consumedAt;
    return Promise.resolve(true);
  }

  invalidateOutstandingForPhone(phone: string, at: Date): Promise<void> {
    for (const row of this.rows) {
      if (row.phone === phone && row.consumedAt === null && row.expiresAt > at) {
        row.expiresAt = at;
      }
    }
    return Promise.resolve();
  }

  private toDomain(row: ChallengeRow): OtpChallenge {
    return OtpChallenge.fromPersistence({ ...row, maxAttempts: this.maxAttempts });
  }
}

export class FakeRefreshTokenRepository implements RefreshTokenRepository {
  readonly rows: (StoredRefreshToken & { tokenHash: string })[] = [];

  create(input: CreateRefreshTokenInput): Promise<StoredRefreshToken> {
    const row = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      family: input.family,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };

    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    return Promise.resolve(this.rows.find((row) => row.tokenHash === tokenHash) ?? null);
  }

  async rotate(
    oldTokenId: string,
    next: CreateRefreshTokenInput,
    at: Date,
  ): Promise<StoredRefreshToken> {
    const old = this.rows.find((row) => row.id === oldTokenId);
    if (old !== undefined) old.revokedAt = at;

    return this.create(next);
  }

  revokeFamily(family: string, at: Date): Promise<number> {
    let count = 0;

    for (const row of this.rows) {
      if (row.family === family && row.revokedAt === null) {
        row.revokedAt = at;
        count += 1;
      }
    }

    return Promise.resolve(count);
  }

  revokeById(id: string, at: Date): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row?.revokedAt === null) row.revokedAt = at;
    return Promise.resolve();
  }
}

export interface FakeUserSeed {
  id?: string;
  phone: string;
  email?: string | null;
  name?: string | null;
  role?: Role;
  passwordHash?: string | null;
  isActive?: boolean;
  phoneVerifiedAt?: Date | null;
}

export class FakeUserRepository implements UserRepository {
  readonly users: User[] = [];

  seed(seed: FakeUserSeed): User {
    const user = UserEntity.fromPersistence({
      id: seed.id ?? randomUUID(),
      phone: seed.phone,
      email: seed.email ?? null,
      name: seed.name ?? null,
      role: seed.role ?? 'CUSTOMER',
      passwordHash: seed.passwordHash ?? null,
      phoneVerifiedAt: seed.phoneVerifiedAt ?? null,
      isActive: seed.isActive ?? true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    this.users.push(user);
    return user;
  }

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((user) => user.id === id) ?? null);
  }

  findByPhone(phone: string): Promise<User | null> {
    return Promise.resolve(this.users.find((user) => user.phone === phone) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(this.users.find((user) => user.email === email) ?? null);
  }

  findOrCreateByPhone(phone: string, role: Role, verifiedAt: Date): Promise<User> {
    const existing = this.users.find((user) => user.phone === phone);
    if (existing !== undefined) return Promise.resolve(existing);

    return Promise.resolve(this.seed({ phone, role, phoneVerifiedAt: verifiedAt }));
  }

  updateProfile(id: string, input: UpdateUserProfileInput): Promise<User> {
    const index = this.users.findIndex((user) => user.id === id);
    const current = this.users[index];

    if (current === undefined) throw new Error(`No user ${id}`);

    const updated = UserEntity.fromPersistence({
      id: current.id,
      phone: current.phone,
      // NOT `input.email ?? current.email`. `email` is `string | null | undefined`, where
      // null means "clear it" and undefined means "not supplied" — `??` would collapse the
      // two and silently keep the old address when the user asked to remove it.
      // `name` has no null in its type, so `??` there is equivalent and fine.
      email: input.email !== undefined ? input.email : current.email,
      name: input.name ?? current.name,
      role: current.role,
      passwordHash: current.passwordHash,
      phoneVerifiedAt: current.phoneVerifiedAt,
      isActive: current.isActive,
      createdAt: current.createdAt,
    });

    this.users[index] = updated;
    return Promise.resolve(updated);
  }

  markPhoneVerified(): Promise<void> {
    return Promise.resolve();
  }
}

export const testAuthConfig: AuthConfig = {
  otpTtlSeconds: 300,
  otpLength: 6,
  otpMaxAttempts: 5,
  otpMaxRequestsPerPhone: 5,
  otpPhoneWindowSeconds: 3600,
  otpMaxRequestsPerIp: 20,
  otpIpWindowSeconds: 3600,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
};
