export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Surfaced to the client as `Retry-After`. */
  retryAfterSeconds: number;
}

/**
 * A fixed-window counter, backed by Redis.
 *
 * Redis rather than in-process memory because the API runs as multiple replicas: an
 * in-memory counter would give an attacker N times the budget simply by spreading
 * requests across pods, which is exactly the case @nestjs/throttler's default
 * in-memory store gets wrong.
 */
export interface RateLimiter {
  /** Atomically increments the counter for `key` and reports whether it is over budget. */
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;

  /** Clears a counter. Used to refund a phone's budget when SMS delivery fails. */
  reset(key: string): Promise<void>;
}

export const RATE_LIMITER = Symbol('RATE_LIMITER');
