import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Component tests run in jsdom with the React plugin. The `@/*` alias mirrors the app's
 * tsconfig so tests import exactly as the app does. Only `test/**` is picked up — Next's route
 * files are exercised by the app itself, not unit-tested here.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
