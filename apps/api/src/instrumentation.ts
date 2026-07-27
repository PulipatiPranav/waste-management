/**
 * Process-level instrumentation: OpenTelemetry tracing and Sentry error reporting.
 *
 * This file is imported FIRST in `main.ts`, before any other application code. That order is not
 * cosmetic: OpenTelemetry patches libraries (http, express, ioredis, Prisma) by intercepting their
 * `require`, so the SDK must start before those modules are first loaded — which happens the moment
 * `AppModule` is imported. Sentry likewise wants to install its global handlers before anything runs.
 *
 * It reads `process.env` directly rather than the validated `ConfigService`, because the Nest
 * config module has not booted yet. Both subsystems are OFF unless explicitly configured, so local
 * dev and the test suite pay nothing and need no collector or DSN. `startInstrumentation` returns a
 * shutdown hook that `main.ts` registers, so spans are flushed on a clean exit.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import * as Sentry from '@sentry/node';

export type ShutdownInstrumentation = () => Promise<void>;

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'cpe-api';
const SERVICE_VERSION = process.env.npm_package_version ?? '0.0.0';

/**
 * Starts Sentry (if a DSN is set) and OpenTelemetry (if OTEL_ENABLED=true). Safe to call once at
 * process start. Returns a function that flushes and shuts both down.
 */
export function startInstrumentation(): ShutdownInstrumentation {
  const shutdowns: ShutdownInstrumentation[] = [];

  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn !== undefined && sentryDsn.trim().length > 0) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: SERVICE_VERSION,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
      // The pino redaction (see logger.config.ts) covers logs; this covers error payloads. Strip
      // the same secret-bearing headers before an event leaves the process.
      beforeSend(event) {
        const headers = event.request?.headers;
        if (headers) {
          for (const key of Object.keys(headers)) {
            if (SENSITIVE_HEADERS.has(key.toLowerCase())) headers[key] = '[redacted]';
          }
        }
        return event;
      },
    });
    shutdowns.push(async () => {
      await Sentry.flush(2000);
    });
  }

  const otelEnabled = process.env.OTEL_ENABLED === 'true';
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otelEnabled && endpoint !== undefined && endpoint.trim().length > 0) {
    // Surface exporter/connection problems as diagnostics rather than silent span loss.
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
      }),
      traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
      instrumentations: [
        // Do not trace the k8s probes or the metrics scrape — they fire every few seconds per pod
        // and would drown the useful traces.
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? '';
            return url.startsWith('/health/') || url === '/metrics' || url.startsWith('/metrics?');
          },
        }),
        new ExpressInstrumentation(),
        new IORedisInstrumentation(),
        // Prisma emits spans for every query (connection, serialization, DB round-trip) once its
        // client is created with tracing enabled — the DB-query traces the brief asks for.
        new PrismaInstrumentation(),
      ],
    });

    sdk.start();
    shutdowns.push(async () => {
      await sdk.shutdown();
    });
  }

  return async () => {
    // Shut down in reverse order; swallow errors so a flaky collector never blocks process exit.
    for (const shutdown of shutdowns.reverse()) {
      try {
        await shutdown();
      } catch {
        // Best-effort flush on shutdown.
      }
    }
  };
}

/** Headers that must never appear in an error report or a trace attribute. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
]);
