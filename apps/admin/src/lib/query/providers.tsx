'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../api/client';
import { AuthProvider } from '../auth/auth-context';

/**
 * App-wide providers: TanStack Query for data fetching/caching, wrapping the auth state.
 *
 * The QueryClient lives in state (not a module singleton) so each browser session gets its own
 * cache and nothing leaks across React Strict-Mode remounts. Retries are deliberately conservative
 * for an ops tool: a 4xx (a real 404, a 403) is never retried — it is an answer, not a blip — and
 * even a 5xx is retried only once, because a support agent staring at a spinner wants the error,
 * not three silent re-attempts.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 1;
            },
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
