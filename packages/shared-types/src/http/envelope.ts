/** ISO-8601 timestamp, e.g. `2026-07-13T09:41:00.000Z`. */
export type IsoDateTimeString = string;

/**
 * The single error shape every API endpoint returns on failure.
 *
 * `correlationId` is echoed from the inbound request so a support agent can take
 * an error a user screenshotted and find the exact request in the logs.
 */
export interface ApiErrorResponse {
  statusCode: number;
  /** Stable, machine-readable code (e.g. `PICKUP_ALREADY_COMPLETED`). */
  code: string;
  /** Human-readable message. Safe to surface to clients; never contains internals. */
  message: string;
  path: string;
  timestamp: IsoDateTimeString;
  correlationId: string;
  /** Field-level validation failures, keyed by dotted field path. */
  details?: Record<string, string[]>;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  uptimeSeconds: number;
  version: string;
  timestamp: IsoDateTimeString;
}
