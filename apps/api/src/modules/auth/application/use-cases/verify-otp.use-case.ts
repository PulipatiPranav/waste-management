import { Inject, Injectable, Logger } from '@nestjs/common';

import { USER_REPOSITORY, type UserRepository } from '@/modules/users/domain/ports/user.repository';
import { AUTH_CONFIG, type AuthConfig } from '../auth.config';
import {
  AccountSuspendedError,
  InvalidOtpError,
  OtpAttemptsExceededError,
} from '../../domain/errors/auth.errors';
import { CLOCK, type Clock } from '../../domain/ports/clock.port';
import { SECRET_HASHER, type SecretHasher } from '../../domain/ports/hasher.port';
import {
  OTP_CHALLENGE_REPOSITORY,
  type OtpChallengeRepository,
} from '../../domain/ports/otp-challenge.repository';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import {
  type IssuedSession,
  type SessionContext,
  SessionIssuerService,
} from '../services/session-issuer.service';

export interface VerifyOtpCommand {
  phone: string;
  code: string;
  context: SessionContext;
}

export interface VerifyOtpResult extends IssuedSession {
  /** True when this verification created the account. Lets the client route to onboarding. */
  isNewUser: boolean;
}

/**
 * Verify an OTP and start a session — registration and login are the same operation
 * for a customer, since possession of the phone IS the credential.
 */
@Injectable()
export class VerifyOtpUseCase {
  private readonly logger = new Logger(VerifyOtpUseCase.name);

  constructor(
    @Inject(OTP_CHALLENGE_REPOSITORY) private readonly challenges: OtpChallengeRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SECRET_HASHER) private readonly hasher: SecretHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly sessionIssuer: SessionIssuerService,
  ) {}

  async execute(command: VerifyOtpCommand): Promise<VerifyOtpResult> {
    const phone = PhoneNumber.create(command.phone);
    const now = this.clock.now();

    const challenge = await this.challenges.findLatestByPhone(phone.e164);

    if (challenge === null) {
      // Same error as a wrong code: revealing "no challenge exists" tells an attacker
      // which numbers have logins in flight.
      throw new InvalidOtpError();
    }

    const rejection = challenge.checkUsable(now);

    if (rejection === 'attempts_exceeded') {
      throw new OtpAttemptsExceededError();
    }

    if (rejection !== null) {
      // 'expired' and 'consumed' both collapse to the generic error.
      throw new InvalidOtpError();
    }

    const matches = await this.hasher.verify(challenge.codeHash, command.code);

    if (!matches) {
      // Count the failure BEFORE returning, or the attempt cap does nothing and the
      // 6-digit code can be walked at whatever rate the rate limiter allows.
      await this.challenges.incrementAttempts(challenge.id);

      const attemptsUsed = challenge.attempts + 1;
      if (attemptsUsed >= this.config.otpMaxAttempts) {
        this.logger.warn(`OTP challenge exhausted for ${phone.masked}`);
      }

      throw new InvalidOtpError();
    }

    // Single-use, decided by the database. Two requests carrying the correct code at
    // the same instant both reach here; the conditional UPDATE lets exactly one win.
    const consumed = await this.challenges.consume(challenge.id, now);

    if (!consumed) {
      throw new InvalidOtpError();
    }

    const existing = await this.users.findByPhone(phone.e164);
    const isNewUser = existing === null;

    const user = await this.users.findOrCreateByPhone(phone.e164, 'CUSTOMER', now);

    // Checked after consuming the challenge, so a suspended user still burns their
    // code rather than being handed an oracle for "is this number registered".
    if (!user.isActive) {
      throw new AccountSuspendedError();
    }

    if (user.phoneVerifiedAt === null) {
      await this.users.markPhoneVerified(user.id, now);
    }

    this.logger.log(`${isNewUser ? 'Registered' : 'Authenticated'} user via OTP: ${phone.masked}`);

    const session = await this.sessionIssuer.issueForUser(user, command.context);

    return { ...session, isNewUser };
  }
}
