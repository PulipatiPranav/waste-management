import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Emits a minimal server bundle for the container image built in infra/docker.
  output: 'standalone',

  // Trace from the workspace root, not from apps/admin. pnpm symlinks workspace
  // packages in from the root, and without this Next omits them from the standalone
  // bundle — the image then builds fine and dies at runtime on "Cannot find module".
  // It costs nothing today (admin imports only *types*, which erase at compile time)
  // and starts mattering the moment shared code carries a runtime value.
  // `next build` always runs with cwd = this package.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),

  // Typed routes catch a link to a deleted ops page at build time rather than in
  // production, when a support agent clicks it mid-incident.
  typedRoutes: true,

  eslint: {
    // Linting is a separate CI step (`pnpm lint`) using the workspace's flat config;
    // running it again inside `next build` would double the work and diverge.
    ignoreDuringBuilds: true,
  },
};

/**
 * Sentry wraps the config to instrument the build and (in CI, with an auth token) upload source maps
 * so a minified stack trace resolves back to real code. It is inert without a DSN, and skips the
 * source-map upload without `SENTRY_AUTH_TOKEN`, so local `next build` is unaffected.
 */
export default withSentryConfig(nextConfig, {
  // `exactOptionalPropertyTypes` forbids passing an explicit `undefined`, so only set org/project
  // when they are actually configured (CI with the upload secrets).
  ...(process.env.SENTRY_ORG !== undefined ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT !== undefined ? { project: process.env.SENTRY_PROJECT } : {}),
  // Quiet unless in CI, where the upload logs are worth seeing.
  silent: process.env.CI === undefined,
  // Route Sentry's browser requests through our own domain so ad blockers do not eat error reports.
  tunnelRoute: '/monitoring',
  // Keep the client bundle lean: drop the Sentry SDK's own debug logging in production builds.
  disableLogger: true,
});
