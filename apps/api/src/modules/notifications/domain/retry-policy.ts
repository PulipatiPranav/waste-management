import { type PushOutcome } from './ports/notification-provider.port';

/**
 * The retry/backoff and dead-letter policy for sending a notification. Pure, so the rules that
 * decide "retry, give up, or done" can be tested exhaustively without a queue or a network — and
 * so the single most important promise of this module (a failed push is never silently dropped)
 * is enforced by a function, not by remembering to handle every branch at the call site.
 */

/**
 * How many times the queue will attempt a notification before it becomes a permanent dead-letter.
 * Four is enough to ride out a brief provider outage or a throttle window without holding a job
 * for hours; beyond that the failure is almost never transient.
 */
export const NOTIFICATION_MAX_ATTEMPTS = 4;

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;

/**
 * Exponential backoff for the Nth attempt (1-based): 5s, 10s, 20s, … capped at 5 minutes. The cap
 * matters — unbounded exponential backoff on a 4-attempt job is fine, but the cap keeps the shape
 * sane if MAX_ATTEMPTS is ever raised, and makes the delays predictable in a test.
 */
export function computeBackoffMs(attempt: number): number {
  if (attempt < 1) return BASE_DELAY_MS;
  const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

export type SendDecision = 'SENT' | 'RETRY' | 'DEAD_LETTER';

export interface SendVerdict {
  decision: SendDecision;
  /** Tokens the provider reported as permanently dead — to be deactivated, never retried. */
  deadTokens: string[];
  /** A short reason, stored on the notification row for a dead-letter to be diagnosable. */
  reason: string;
}

/**
 * Turns the per-device outcomes of one send attempt into a verdict for the whole notification.
 *
 *   - Any device succeeded            -> SENT (the customer got it on at least one device).
 *   - Nothing succeeded, some blip    -> RETRY (a transient failure is worth another attempt).
 *   - Nothing succeeded, all dead     -> DEAD_LETTER (every target is permanently gone).
 *   - No targets at all               -> DEAD_LETTER (nowhere to deliver — recorded, not dropped).
 *
 * The order matters: one success beats any number of failures, and a single retryable failure
 * beats a pile of permanent ones, because the retryable one might carry the message through next
 * time while the permanent ones never will.
 */
export function decidePushOutcome(outcomes: readonly PushOutcome[]): SendVerdict {
  const deadTokens = outcomes.filter((o) => !o.ok && o.permanent).map((o) => o.token);

  if (outcomes.length === 0) {
    return { decision: 'DEAD_LETTER', deadTokens, reason: 'No active device tokens to send to.' };
  }

  if (outcomes.some((o) => o.ok)) {
    return { decision: 'SENT', deadTokens, reason: 'Delivered to at least one device.' };
  }

  const transient = outcomes.filter((o) => !o.ok && !o.permanent);
  if (transient.length > 0) {
    const reason = transient[0]?.error ?? 'Transient provider failure.';
    return { decision: 'RETRY', deadTokens, reason };
  }

  return {
    decision: 'DEAD_LETTER',
    deadTokens,
    reason: outcomes.find((o) => o.error !== undefined)?.error ?? 'All device tokens are dead.',
  };
}

/** Whether this was the last attempt the queue will make. A RETRY here becomes a dead-letter. */
export function isFinalAttempt(
  attemptsMade: number,
  maxAttempts = NOTIFICATION_MAX_ATTEMPTS,
): boolean {
  return attemptsMade >= maxAttempts;
}
