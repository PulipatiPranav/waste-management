/**
 * Next.js server/edge instrumentation hook. Initialises Sentry for the server runtime when a DSN is
 * configured; a no-op otherwise, so local dev and CI need no DSN.
 *
 * The browser half lives in `instrumentation-client.ts`. Both are gated on their own DSN env var so
 * nothing is sent from an unconfigured environment.
 */
import * as Sentry from '@sentry/nextjs';

export function register(): void {
  const dsn = process.env.SENTRY_DSN;
  if (dsn === undefined || dsn.trim().length === 0) return;

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    });
  }
}

// Lets Next report server-component and route-handler errors to Sentry.
export const onRequestError = Sentry.captureRequestError;
