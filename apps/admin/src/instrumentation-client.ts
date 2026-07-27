/**
 * Browser-side Sentry init, run once when the client bundle loads.
 *
 * The DSN is `NEXT_PUBLIC_*` because it is inlined into the client bundle — and that is fine: a
 * Sentry DSN is an ingest key, designed to be public (it can only WRITE events, never read them).
 * No real secret goes here. Inert unless the DSN is set.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn !== undefined && dsn.trim().length > 0) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? 'development',
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    // Session Replay is off by default: an ops dashboard shows customer PII (phones, addresses,
    // wallet balances), and replays would ship that to a third party. Turn on deliberately, if ever.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

// Instruments client-side navigations so Sentry can tie errors to the route the user was on.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
