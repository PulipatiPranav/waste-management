/**
 * Injectable time.
 *
 * Every expiry rule in this module is a comparison against "now", and a test that
 * cannot control "now" either sleeps for five minutes or does not really test the
 * rule. `new Date()` scattered through use cases makes both impossible.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
