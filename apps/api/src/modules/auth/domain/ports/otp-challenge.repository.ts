import { type OtpChallenge } from '../entities/otp-challenge';

export interface CreateOtpChallengeInput {
  phone: string;
  codeHash: string;
  expiresAt: Date;
  requestIp: string | null;
}

export interface OtpChallengeRepository {
  create(input: CreateOtpChallengeInput): Promise<OtpChallenge>;

  /** The newest challenge for a phone, regardless of state. Null if there is none. */
  findLatestByPhone(phone: string): Promise<OtpChallenge | null>;

  incrementAttempts(id: string): Promise<void>;

  /**
   * Marks the challenge consumed, but ONLY if it is not already consumed.
   *
   * Returns false when it was already consumed. This must be a conditional update in
   * SQL rather than a read-then-write: two verify requests racing with the correct
   * code would both pass the entity's `isConsumed()` check and both mint a session.
   * The database decides the winner.
   */
  consume(id: string, consumedAt: Date): Promise<boolean>;

  /** Invalidates any live challenges for a phone. Called when a new one is issued. */
  invalidateOutstandingForPhone(phone: string, at: Date): Promise<void>;
}

export const OTP_CHALLENGE_REPOSITORY = Symbol('OTP_CHALLENGE_REPOSITORY');
