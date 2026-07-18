import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore, migrateLegacyTokens } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  guestRegister: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Move any pre-cookie session into httpOnly cookies, then ask who we are. We always
    // hit /auth/me: the session is now carried by a cookie we can't read, so we can't
    // short-circuit on "no local token" anymore (an anonymous visitor just gets a 401).
    (async () => {
      await migrateLegacyTokens();
      try {
        const r = await api.get<{ user: User }>('/auth/me');
        setUser(r.user);
      } catch {
        tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    // The server sets httpOnly auth cookies; nothing to store client-side. Clear any stale
    // legacy tokens so we don't keep sending a Bearer header.
    const res = await api.post<{ user: User }>('/auth/login', { email, password });
    tokenStore.clear();
    setUser(res.user);
  };

  // Self-service guest signup — same cookie flow as login (server auto-logs-in on success).
  const guestRegister = async (name: string, email: string, password: string) => {
    const res = await api.post<{ user: User }>('/auth/guest/register', { name, email, password });
    tokenStore.clear();
    setUser(res.user);
  };

  // Sign in with Google — post the ID token (credential) from Google Identity Services; the
  // server verifies it and matches/creates a sandboxed GUEST, setting the same cookie session.
  const loginWithGoogle = async (credential: string) => {
    const res = await api.post<{ user: User }>('/auth/google', { credential });
    tokenStore.clear();
    setUser(res.user);
  };

  const logout = () => {
    // Best-effort server-side revocation (bumps tokenVersion so the tokens can't be
    // reused elsewhere); clear locally regardless of the network result.
    api.post('/auth/logout').catch(() => {});
    tokenStore.clear();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, guestRegister, loginWithGoogle, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
