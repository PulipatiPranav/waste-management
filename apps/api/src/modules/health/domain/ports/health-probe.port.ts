/**
 * Port (in the hexagonal sense) for anything the API's readiness depends on.
 *
 * This file is the seam that keeps the layers honest: the application layer knows
 * only this interface, while `infrastructure/probes/` supplies the Postgres and
 * Redis implementations. Adding a probe for S3 or an SMS provider in a later phase
 * means adding a class and binding it — no change to the use case.
 *
 * Deliberately framework-free: no Nest imports here. The DI token is a plain
 * Symbol; `health.module.ts` is what binds implementations to it.
 */

export type ProbeStatus = 'up' | 'down';

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  durationMs: number;
  /** Populated only when `status` is `down`. Never surfaced to unauthenticated clients. */
  error?: string;
}

export interface HealthProbe {
  /** Stable identifier used as the key in the readiness payload, e.g. `postgres`. */
  readonly name: string;
  check(): Promise<ProbeResult>;
}

/** DI token for the array of all registered probes. */
export const HEALTH_PROBES = Symbol('HEALTH_PROBES');
