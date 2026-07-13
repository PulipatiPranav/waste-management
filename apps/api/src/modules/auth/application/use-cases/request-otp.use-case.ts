import { Inject, Injectable, Logger } from '@nestjs/common';

import { AUTH_CONFIG, type AuthConfig } from '../auth.config';
import { RateLimitExceededError } from '../../domain/errors/auth.errors';
import { CLOCK, type Clock } from '../../domain/ports/clock.port';
import { SECRET_HASHER, type SecretHasher } from '../../domain/ports/hasher.port';
import {
  OTP_CHALLENGE_REPOSITORY,
  type OtpChallengeRepository,
} from '../../domain/ports/otp-challenge.repository';
import {
  OTP_CODE_GENERATOR,
  type OtpCodeGenerator,
} from '../../domain/ports/otp-code-generator.port';
import { RATE_LIMITER, type RateLimiter } from '../../domain/ports/rate-limiter.port';
import { SMS_PROVIDER, type SmsProvider } from '../../domain/ports/sms-provider.port';
import { PhoneNumber } from '../../domain/value-objects/phone-number';

export interface RequestOtpCommand {
  phone: string;
  ip: string | null;
}

export interface RequestOtpResult {
  /** So the client can show "resend in Ns" without guessing. */
  expiresInSeconds: number;
}

@Injectable()
export class RequestOtpUseCase {
  private readonly logger = new Logger(RequestOtpUseCase.name);

  constructor(
    @Inject(OTP_CHALLENGE_REPOSITORY) private readonly challenges: OtpChallengeRepository,
    @Inject(OTP_CODE_GENERATOR) private readonly codeGenerator: OtpCodeGenerator,
    @Inject(SECRET_HASHER) private readonly hasher: SecretHasher,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async execute(command: RequestOtpCommand): Promise<RequestOtpResult> {
    // Throws InvalidPhoneNumberError on garbage. Note this happens BEFORE the rate
    // limiter is touched, so malformed input cannot burn a real number's budget.
    const phone = PhoneNumber.create(command.phone);

    await this.enforceRateLimits(phone, command.ip);

    const now = this.clock.now();

    // Kill any outstanding challenge first. Without this, requesting a second code
    // leaves the first one live, so the attacker gets N valid codes in flight at once
    // instead of one — and the user, reasonably, expects the old code to stop working.
    await this.challenges.invalidateOutstandingForPhone(phone.e164, now);

    const code = this.codeGenerator.generate(this.config.otpLength);
    const codeHash = await this.hasher.hash(code);
    const expiresAt = new Date(now.getTime() + this.config.otpTtlSeconds * 1000);

    await this.challenges.create({
      phone: phone.e164,
      codeHash,
      expiresAt,
      requestIp: command.ip,
    });

    try {
      await this.sms.send({
        to: phone.e164,
        body: `${code} is your Circular Paper Economy verification code. It expires in ${Math.floor(
          this.config.otpTtlSeconds / 60,
        )} minutes. Do not share it with anyone.`,
      });
    } catch (error) {
      // Refund the phone's budget: the user got no SMS, so making them wait an hour
      // for a failure on our side would be punishing them for our outage. The IP
      // budget is deliberately NOT refunded — an attacker who can force send failures
      // must not get free retries.
      await this.rateLimiter.reset(this.phoneKey(phone));

      this.logger.error(
        `Failed to send OTP SMS to ${phone.masked}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }

    // phone.masked, never phone.e164, and never `code`. This line is the one most
    // likely to be copy-pasted into a new log statement later.
    this.logger.log(`OTP issued for ${phone.masked}`);

    return { expiresInSeconds: this.config.otpTtlSeconds };
  }

  /**
   * Per-phone AND per-IP, as the brief requires — they stop different attacks.
   *
   * Phone budget is checked first so that an attacker rotating IPs still cannot
   * SMS-bomb one victim, and a single host cannot enumerate numbers.
   */
  private async enforceRateLimits(phone: PhoneNumber, ip: string | null): Promise<void> {
    const byPhone = await this.rateLimiter.consume(
      this.phoneKey(phone),
      this.config.otpMaxRequestsPerPhone,
      this.config.otpPhoneWindowSeconds,
    );

    if (!byPhone.allowed) {
      this.logger.warn(`OTP rate limit hit for phone ${phone.masked}`);
      throw new RateLimitExceededError(byPhone.retryAfterSeconds);
    }

    if (ip === null) return;

    const byIp = await this.rateLimiter.consume(
      `otp:ip:${ip}`,
      this.config.otpMaxRequestsPerIp,
      this.config.otpIpWindowSeconds,
    );

    if (!byIp.allowed) {
      this.logger.warn(`OTP rate limit hit for ip ${ip}`);
      throw new RateLimitExceededError(byIp.retryAfterSeconds);
    }
  }

  private phoneKey(phone: PhoneNumber): string {
    return `otp:phone:${phone.e164}`;
  }
}
