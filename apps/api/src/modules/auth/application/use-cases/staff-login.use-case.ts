import { Inject, Injectable, Logger } from '@nestjs/common';

import { USER_REPOSITORY, type UserRepository } from '@/modules/users/domain/ports/user.repository';
import {
  AccountSuspendedError,
  InvalidCredentialsError,
  RateLimitExceededError,
} from '../../domain/errors/auth.errors';
import { SECRET_HASHER, type SecretHasher } from '../../domain/ports/hasher.port';
import { RATE_LIMITER, type RateLimiter } from '../../domain/ports/rate-limiter.port';
import { STAFF_ROLES } from '../../domain/value-objects/role';
import {
  type IssuedSession,
  type SessionContext,
  SessionIssuerService,
} from '../services/session-issuer.service';

export interface StaffLoginCommand {
  email: string;
  password: string;
  context: SessionContext;
}

/**
 * Email + password login for staff (OPS_STAFF, SUPER_ADMIN).
 *
 * Customers never take this path — they have no password at all (`passwordHash` is
 * null), so an attacker cannot pivot to password-guessing a customer account.
 */
@Injectable()
export class StaffLoginUseCase {
  private readonly logger = new Logger(StaffLoginUseCase.name);

  private static readonly MAX_ATTEMPTS_PER_EMAIL = 10;
  private static readonly WINDOW_SECONDS = 900;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SECRET_HASHER) private readonly hasher: SecretHasher,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    private readonly sessionIssuer: SessionIssuerService,
  ) {}

  async execute(command: StaffLoginCommand): Promise<IssuedSession> {
    const email = command.email.trim().toLowerCase();

    const decision = await this.rateLimiter.consume(
      `login:email:${email}`,
      StaffLoginUseCase.MAX_ATTEMPTS_PER_EMAIL,
      StaffLoginUseCase.WINDOW_SECONDS,
    );

    if (!decision.allowed) {
      throw new RateLimitExceededError(decision.retryAfterSeconds);
    }

    const user = await this.users.findByEmail(email);

    // Every failure below returns the SAME error. Distinguishing "no such account"
    // from "wrong password" turns this endpoint into a staff-email enumerator.
    if (user === null || !user.canLoginWithPassword() || !STAFF_ROLES.includes(user.role)) {
      // Burn comparable time even when the user does not exist, so response latency
      // does not leak whether the email is real. Argon2 on a dummy hash is the
      // standard trick; without it, "fast 401 = no such user" is measurable.
      await this.hasher.verify(DUMMY_ARGON2_HASH, command.password);
      throw new InvalidCredentialsError();
    }

    const passwordHash = user.passwordHash;
    if (passwordHash === null) {
      await this.hasher.verify(DUMMY_ARGON2_HASH, command.password);
      throw new InvalidCredentialsError();
    }

    const matches = await this.hasher.verify(passwordHash, command.password);

    if (!matches) {
      this.logger.warn(`Failed staff login for ${email}`);
      throw new InvalidCredentialsError();
    }

    if (!user.isActive) {
      throw new AccountSuspendedError();
    }

    this.logger.log(`Staff login: ${email} (${user.role})`);

    return this.sessionIssuer.issueForUser(user, command.context);
  }
}

/**
 * A real Argon2id hash of a value nobody knows, used only to spend the same CPU on a
 * missing user as on a real one. Verifying against it always fails.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmE';
