import path from 'node:path';
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

export default nextConfig;
