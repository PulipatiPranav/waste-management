import { type PushOutcome } from './ports/notification-provider.port';
import {
  computeBackoffMs,
  decidePushOutcome,
  isFinalAttempt,
  NOTIFICATION_MAX_ATTEMPTS,
} from './retry-policy';

const ok = (token: string): PushOutcome => ({ token, ok: true, permanent: false });
const transient = (token: string, error = 'network'): PushOutcome => ({
  token,
  ok: false,
  permanent: false,
  error,
});
const dead = (token: string, error = 'unregistered'): PushOutcome => ({
  token,
  ok: false,
  permanent: true,
  error,
});

describe('computeBackoffMs', () => {
  it('is exponential from a 5s base', () => {
    expect(computeBackoffMs(1)).toBe(5_000);
    expect(computeBackoffMs(2)).toBe(10_000);
    expect(computeBackoffMs(3)).toBe(20_000);
    expect(computeBackoffMs(4)).toBe(40_000);
  });

  it('caps at 5 minutes so raising the attempt count cannot explode the delay', () => {
    expect(computeBackoffMs(20)).toBe(5 * 60_000);
  });

  it('handles a zero/negative attempt defensively', () => {
    expect(computeBackoffMs(0)).toBe(5_000);
  });
});

describe('decidePushOutcome', () => {
  it('SENT if any device succeeded, even amongst failures', () => {
    const v = decidePushOutcome([dead('a'), ok('b'), transient('c')]);
    expect(v.decision).toBe('SENT');
    // Dead tokens are still collected for deactivation even on a SENT.
    expect(v.deadTokens).toEqual(['a']);
  });

  it('RETRY if nothing succeeded but a failure was transient', () => {
    const v = decidePushOutcome([dead('a'), transient('b', 'provider 503')]);
    expect(v.decision).toBe('RETRY');
    expect(v.deadTokens).toEqual(['a']);
    expect(v.reason).toContain('503');
  });

  it('DEAD_LETTER if every failure is permanent', () => {
    const v = decidePushOutcome([dead('a'), dead('b')]);
    expect(v.decision).toBe('DEAD_LETTER');
    expect(v.deadTokens).toEqual(['a', 'b']);
  });

  it('DEAD_LETTER (not a silent drop) when there are no targets at all', () => {
    const v = decidePushOutcome([]);
    expect(v.decision).toBe('DEAD_LETTER');
    expect(v.reason).toMatch(/no active device/i);
  });

  it('a single retryable failure outweighs a pile of permanent ones', () => {
    expect(decidePushOutcome([dead('a'), dead('b'), transient('c')]).decision).toBe('RETRY');
  });
});

describe('isFinalAttempt', () => {
  it('is final once attemptsMade reaches the max', () => {
    expect(isFinalAttempt(NOTIFICATION_MAX_ATTEMPTS - 1)).toBe(false);
    expect(isFinalAttempt(NOTIFICATION_MAX_ATTEMPTS)).toBe(true);
    expect(isFinalAttempt(NOTIFICATION_MAX_ATTEMPTS + 1)).toBe(true);
  });
});
