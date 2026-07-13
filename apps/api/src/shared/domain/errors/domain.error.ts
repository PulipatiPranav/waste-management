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
  readonly code = 'NOT_FOUND';
}

/** The request is well-formed but conflicts with the current state of the resource. */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
}

/** A business invariant was violated (distinct from a DTO-shape validation failure). */
export class InvariantViolationError extends DomainError {
  readonly code = 'INVARIANT_VIOLATION';
}

/** The caller is authenticated but not permitted to perform this action. */
export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
}
