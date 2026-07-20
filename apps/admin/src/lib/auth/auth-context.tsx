'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '../api/client';
import type { Session, UserProfile } from '../api/types';
import { clearSession, getRefreshToken, hasSession, storeSession } from './session';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The console's authentication state, resolved from the API — never from the token's contents.
 * On mount, if a session exists, it fetches `/users/me`; the ROLE that gates every screen comes
 * from that live profile, so a demoted staff member loses access on their next load rather than
 * whenever their token happens to expire. A non-staff account that somehow has a token is treated
 * as unauthenticated here (the backend already refuses it everything).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);

  const loadProfile = useCallback(async (): Promise<void> => {
    if (!hasSession()) {
      setStatus('unauthenticated');
      setUser(null);
      return;
    }
    try {
      const profile = await api.get<UserProfile>('/users/me');
      if (profile.role !== 'OPS_STAFF' && profile.role !== 'SUPER_ADMIN') {
        // Authenticated, but not a console user. Drop the session.
        clearSession();
        setStatus('unauthenticated');
        setUser(null);
        return;
      }
      setUser(profile);
      setStatus('authenticated');
    } catch {
      clearSession();
      setStatus('unauthenticated');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const session = await api.post<Session>('/auth/staff/login', { email, password });
      storeSession(session);
      await loadProfile();
    },
    [loadProfile],
  );

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = getRefreshToken();
    // Best-effort server-side revocation; the local session is cleared regardless.
    if (refreshToken !== null) {
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    clearSession();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
