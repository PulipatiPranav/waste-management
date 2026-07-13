/**
 * Framework-free error types for the domain and application layers.
 *
 * The domain must be able to say "this pickup is already completed" without
 * importing `HttpException` from Nest — otherwise the business rules become
 * unusable outside an HTTP request (queue workers, cron jobs, tests).
 * `AllExceptionsFilter` is the single place that maps these onto status codes.
 */
export abstract class DomainError extends Error {
  /** Stable, machine-readable identifier, e.g. `PICKUP_ALREADY_COMPLETED`. */
  abstract readonly code: string;

  /** Field-level detail, keyed by dotted field path. */
  readonly details?: Record<string, string[]>;

  constructor(message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = new.target.name;
    if (details) {
      this.details = details;
    }
    Error.captureStackTrace(this, new.target);
  }
}

/** The requested resource does not exist, or the caller may not know that it does. */
export class NotFoundError extends DomainError {
  readonly code: string = 'NOT_FOUND';
}

/** The request is well-formed but conflicts with the current state of the resource. */
export class ConflictError extends DomainError {
  readonly code: string = 'CONFLICT';
}

/** A business invariant was violated (distinct from a DTO-shape validation failure). */
export class InvariantViolationError extends DomainError {
  readonly code: string = 'INVARIANT_VIOLATION';
}

/** The caller is authenticated but not permitted to perform this action. */
export class ForbiddenError extends DomainError {
  readonly code: string = 'FORBIDDEN';
}

/**
 * The caller is not authenticated at all — no token, or a bad one. Distinct from
 * ForbiddenError: 401 means "log in", 403 means "logged in, but not allowed".
 */
export abstract class UnauthorizedDomainError extends DomainError {}

/**
 * Too many requests. Carries `retryAfterSeconds` because a 429 without a Retry-After
 * header just invites the client to hammer the endpoint in a tight loop.
 */
export abstract class TooManyRequestsDomainError extends DomainError {
  abstract readonly retryAfterSeconds: number;
}
