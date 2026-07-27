import { randomUUID } from 'node:crypto';

import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Options as PinoHttpOptions } from 'pino-http';

import { CORRELATION_ID_HEADER } from '@/shared/presentation/middleware/correlation-id.middleware';

/**
 * The paths pino redacts before a log line is written. Secrets must never reach the log stream —
 * that is an explicit item on the Phase 14 OWASP checklist ("check secrets aren't logged").
 *
 * pino-http does NOT log request bodies by default, so the OTP code and JWTs in request payloads
 * are already out of the logs; these paths cover the headers it DOES log (the bearer token, cookies)
 * plus a defensive sweep of common secret-bearing keys for any object we log ourselves.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.password',
  '*.otp',
  '*.code',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
];

interface WithCorrelation extends IncomingMessage {
  correlationId?: string;
}

/**
 * Builds the pino-http options: JSON logs, a redaction policy, and a request id that IS the
 * correlation id.
 *
 * `genReqId` is the single place the correlation id is minted per request, reusing an id the mobile
 * app sent (so "my cashback didn't arrive" traces to the exact request chain) and stamping it on
 * both `req.correlationId` and the response header. It is idempotent with
 * `CorrelationIdMiddleware` — whichever runs first wins, the other reuses the value — so the id is
 * the same regardless of middleware order, and every log line for the request carries `reqId`.
 */
export function buildPinoHttpOptions(level: string): PinoHttpOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    // A stable field name across services; `reqId` is what appears on every request-scoped line.
    genReqId: (req: WithCorrelation, res: ServerResponse): string => {
      const incoming = req.headers[CORRELATION_ID_HEADER];
      const header = Array.isArray(incoming) ? incoming[0] : incoming;
      const id = req.correlationId ?? (header && header.trim().length > 0 ? header : randomUUID());
      req.correlationId = id;
      if (!res.headersSent) res.setHeader(CORRELATION_ID_HEADER, id);
      return id;
    },
    // Health probes and the metrics scrape hit constantly; logging each one buries real traffic.
    autoLogging: {
      ignore: (req: IncomingMessage): boolean => {
        const url = req.url ?? '';
        return url.startsWith('/health/') || url === '/metrics' || url.startsWith('/metrics?');
      },
    },
    // Trim the request/response objects to what is useful for support debugging — not the whole
    // socket. The bearer token is redacted above; here we simply do not serialise noise.
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customProps: (req: WithCorrelation) => ({ correlationId: req.correlationId }),
  };
}
