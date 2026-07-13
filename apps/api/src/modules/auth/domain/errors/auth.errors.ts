import {
  DomainError,
  ForbiddenError,
  TooManyRequestsDomainError,
  UnauthorizedDomainError,
} from '@/shared/domain/errors/domain.error';

export class InvalidPhoneNumberError extends DomainError {
  readonly code = 'INVALID_PHONE_NUMBER';
}

/**
 * Deliberately vague, and deliberately the SAME error for "no challenge exists",
 * "wrong code", "already used" and "expired".
 *
 * Distinguishing them tells an attacker which phone numbers have pending
 * challenges and lets them separate "this code was wrong" from "this code was
 * right but stale" — free oracle. The user experience cost is nil; the client
 * says "that code didn't work, request a new one" either way.
 */
export class InvalidOtpError extends UnauthorizedDomainError {
  readonly code = 'INVALID_OTP';

  constructor() {
    super('The code is incorrect or has expired. Request a new one.');
  }
}

/** The challenge is dead: too many wrong guesses. Distinct because the user must
 *  be told to request a *new* code rather than keep trying this one. */
export class OtpAttemptsExceededError extends UnauthorizedDomainError {
  readonly code = 'OTP_ATTEMPTS_EXCEEDED';

  constructor() {
    super('Too many incorrect attempts. Request a new code.');
  }
}

export class RateLimitExceededError extends TooManyRequestsDomainError {
  readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Try again later.');
  }
}

/** Access token missing, malformed, or expired. */
export class UnauthenticatedError extends UnauthorizedDomainError {
  readonly code = 'UNAUTHENTICATED';
}

export class InvalidRefreshTokenError extends UnauthorizedDomainError {
  readonly code = 'INVALID_REFRESH_TOKEN';

  constructor(message = 'The refresh token is invalid or has expired. Sign in again.') {
    super(message);
  }
}

/** Same message for unknown user and wrong password — never confirm which. */
export class InvalidCredentialsError extends UnauthorizedDomainError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Incorrect email or password.');
  }
}

/**
 * 403, not 401: the credential is valid, the account is just disabled. Returning 401
 * would tell the client to retry the login flow, which would succeed and then fail
 * again on the next request — an infinite loop.
 */
export class AccountSuspendedError extends ForbiddenError {
  override readonly code = 'ACCOUNT_SUSPENDED';

  constructor() {
    super('This account has been suspended.');
  }
}
