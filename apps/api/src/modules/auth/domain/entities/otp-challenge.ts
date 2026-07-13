/**
 * An OTP challenge and the rules governing when it may be used.
 *
 * Every guard the brief asks for — expiry, single-use, attempt cap — is decided
 * here, in pure code, with time injected. That is what lets the tests prove
 * "expires after exactly 5 minutes" and "a consumed code is refused even while
 * still unexpired" without a database, a clock hack, or a five-minute sleep.
 *
 * The plaintext code is NOT a field of this entity. It exists for one instant in
 * `RequestOtpUseCase` (to be hashed and handed to the SMS provider) and is never
 * persisted, logged, or returned.
 */
export type OtpRejectionReason = 'expired' | 'consumed' | 'attempts_exceeded' | 'wrong_code';

export interface OtpChallengeProps {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  maxAttempts: number;
}

export class OtpChallenge {
  private constructor(private readonly props: OtpChallengeProps) {}

  static fromPersistence(props: OtpChallengeProps): OtpChallenge {
    return new OtpChallenge(props);
  }

  get id(): string {
    return this.props.id;
  }

  get phone(): string {
    return this.props.phone;
  }

  get codeHash(): string {
    return this.props.codeHash;
  }

  get attempts(): number {
    return this.props.attempts;
  }

  isExpired(now: Date): boolean {
    // `<=` not `<`: a challenge is dead *at* its expiry instant, not one tick after.
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  isConsumed(): boolean {
    return this.props.consumedAt !== null;
  }

  hasAttemptsLeft(): boolean {
    return this.props.attempts < this.props.maxAttempts;
  }

  /**
   * Whether this challenge may be attempted at all, before the code is even compared.
   *
   * Returns the reason rather than a boolean so the caller can distinguish
   * "attempts exceeded" (tell the user to request a new code) from the rest (which
   * all collapse into one deliberately vague error — see InvalidOtpError).
   */
  checkUsable(now: Date): OtpRejectionReason | null {
    if (this.isConsumed()) return 'consumed';
    if (this.isExpired(now)) return 'expired';
    if (!this.hasAttemptsLeft()) return 'attempts_exceeded';
    return null;
  }
}
