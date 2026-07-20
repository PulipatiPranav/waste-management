import { API_BASE_URL } from '../env';
import { clearSession, getAccessToken, getRefreshToken, storeSession } from '../auth/session';
import type { Session } from './types';

/**
 * A thrown API error, carrying the HTTP status and the API's machine-readable `code` so callers
 * can branch (a 404 on a wallet lookup is "no such user", not a crash) and show the server's
 * message rather than a generic one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Extra headers, e.g. an Idempotency-Key for a money-moving action. */
  headers?: Record<string, string>;
  /** Set false for the refresh call itself, so a failed refresh does not recurse. */
  allowRefresh?: boolean;
}

/**
 * The one place every API call goes through. It attaches the bearer token, parses the API's
 * error envelope into an ApiError, and — on a 401 — transparently rotates the token once and
 * retries. A single in-flight refresh is shared across concurrent 401s so a burst of expired
 * requests does not fire a thundering herd of refreshes.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (refreshToken === null) return false;

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearSession();
        return false;
      }
      storeSession((await res.json()) as Session);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, allowRefresh = true } = options;
  const token = getAccessToken();

  const init: RequestInit = {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, init);

  if (response.status === 401 && allowRefresh) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, allowRefresh: false });
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload as { code?: string; message?: string } | null;
    throw new ApiError(
      response.status,
      envelope?.code ?? 'HTTP_ERROR',
      envelope?.message ?? `Request failed (${response.status})`,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiFetch<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
      ...(headers === undefined ? {} : { headers }),
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', ...(body === undefined ? {} : { body }) }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', ...(body === undefined ? {} : { body }) }),
  del: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
