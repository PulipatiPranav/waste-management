import type { Session } from '../api/types';

/**
 * Token storage for the console.
 *
 * Tokens live in `localStorage`. For an INTERNAL, staff-only tool served over TLS this is a
 * reasonable trade: it survives a refresh, works across tabs, and needs no cookie/CSRF dance. It
 * is NOT what a public consumer app should do (an httpOnly cookie is XSS-safer) — the honest note
 * is here so the choice is deliberate, not accidental. Access tokens are short-lived (15m) and
 * rotate; the refresh token is the sensitive one and never leaves this origin.
 */
const ACCESS_KEY = 'cpe.admin.accessToken';
const REFRESH_KEY = 'cpe.admin.refreshToken';

function browser(): boolean {
  return typeof window !== 'undefined';
}

export function getAccessToken(): string | null {
  return browser() ? window.localStorage.getItem(ACCESS_KEY) : null;
}

export function getRefreshToken(): string | null {
  return browser() ? window.localStorage.getItem(REFRESH_KEY) : null;
}

export function storeSession(session: Session): void {
  if (!browser()) return;
  window.localStorage.setItem(ACCESS_KEY, session.accessToken);
  window.localStorage.setItem(REFRESH_KEY, session.refreshToken);
}

export function clearSession(): void {
  if (!browser()) return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export function hasSession(): boolean {
  return getAccessToken() !== null;
}
