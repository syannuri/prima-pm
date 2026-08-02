import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore, migrateLegacyTokens, setImpersonation } from '../api/client';
import type { User, TenantSummary } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, captchaToken?: string) => Promise<void>;
  guestRegister: (name: string, email: string, password: string, captchaToken?: string) => Promise<void>;
  signupOrg: (orgName: string, ownerName: string, email: string, password: string, captchaToken?: string) => Promise<{ pending: true; orgName: string }>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
  // Pooled multitenancy: the tenants this user belongs to, the active one, and a switcher.
  // Empty / single-entry when the deployment is single-tenant (enforcement off) — the UI hides
  // the switcher then, so nothing changes for those users.
  tenants: TenantSummary[];
  activeTenantId: string | null;
  switchTenant: (tenantId: string) => Promise<void>;
  // Platform (super-admin) impersonation: act inside another tenant. `impersonating` drives the
  // banner; transient (in-memory bearer token) — a page reload ends it, reverting to the cookie session.
  impersonating: { tenantId: string; name: string } | null;
  impersonate: (tenantId: string, name: string) => Promise<void>;
  stopImpersonating: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<{ tenantId: string; name: string } | null>(null);

  // The tenants the signed-in user belongs to (for the switcher). Best-effort: on any failure we
  // just leave the list empty, which hides the switcher.
  const loadTenants = async () => {
    try {
      const r = await api.get<{ tenants: TenantSummary[]; active: string | null }>('/auth/tenants');
      setTenants(r.tenants);
      setActiveTenantId(r.active);
    } catch {
      setTenants([]);
      setActiveTenantId(null);
    }
  };

  useEffect(() => {
    // Move any pre-cookie session into httpOnly cookies, then ask who we are. We always
    // hit /auth/me: the session is now carried by a cookie we can't read, so we can't
    // short-circuit on "no local token" anymore (an anonymous visitor just gets a 401).
    (async () => {
      await migrateLegacyTokens();
      try {
        const r = await api.get<{ user: User }>('/auth/me');
        setUser(r.user);
        await loadTenants();
      } catch {
        tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Switch the active tenant: the server re-mints the session cookies pinned to the new tenant,
  // then we hard-reload so every query re-fetches under the new scope (simplest correct path — a
  // tenant switch changes essentially all visible data).
  const switchTenant = async (tenantId: string) => {
    if (tenantId === activeTenantId) return;
    await api.post('/auth/switch-tenant', { tenantId });
    window.location.reload();
  };

  // Refresh identity + tenant list + all cached data under whatever session is now active (the
  // impersonation bearer, or the cookie session once it's cleared).
  const reloadIdentity = async () => {
    try { const r = await api.get<{ user: User }>('/auth/me'); setUser(r.user); } catch { /* keep prior */ }
    await loadTenants();
    qc.invalidateQueries();
  };

  // Enter a tenant as a platform super-admin. Sets the override bearer token FIRST so the identity +
  // data refetch under the impersonated scope. If the token later expires, the api client auto-reverts
  // and calls back to end it (endImpersonation).
  const endImpersonation = () => { setImpersonating(null); void reloadIdentity(); };
  const impersonate = async (tenantId: string, name: string) => {
    const r = await api.post<{ accessToken: string; tenant: { id: string; name: string } }>(`/admin/tenants/${tenantId}/impersonate`);
    setImpersonation(r.accessToken, endImpersonation);
    setImpersonating({ tenantId, name: r.tenant.name || name });
    await reloadIdentity();
  };
  const stopImpersonating = async () => {
    setImpersonation(null);
    setImpersonating(null);
    await reloadIdentity();
  };

  const login = async (email: string, password: string, captchaToken?: string) => {
    // The server sets httpOnly auth cookies; nothing to store client-side. Clear any stale
    // legacy tokens so we don't keep sending a Bearer header. captchaToken is only verified when
    // the deployment has Turnstile configured (ignored otherwise).
    const res = await api.post<{ user: User }>('/auth/login', { email, password, captchaToken });
    tokenStore.clear();
    setUser(res.user);
    await loadTenants();
  };

  // Self-service guest signup — same cookie flow as login (server auto-logs-in on success).
  const guestRegister = async (name: string, email: string, password: string, captchaToken?: string) => {
    const res = await api.post<{ user: User }>('/auth/guest/register', { name, email, password, captchaToken });
    tokenStore.clear();
    setUser(res.user);
    await loadTenants();
  };

  // Self-serve organization signup (option C — manual approval): creates a PENDING corporate tenant +
  // owner admin. Does NOT log in — the owner must wait for a platform admin to approve. Returns the
  // pending marker so the UI can show a "waiting for approval" screen instead of routing to a session.
  const signupOrg = async (orgName: string, ownerName: string, email: string, password: string, captchaToken?: string) => {
    return api.post<{ pending: true; orgName: string }>('/auth/signup', { orgName, ownerName, email, password, captchaToken });
  };

  // Sign in with Google — post the ID token (credential) from Google Identity Services; the
  // server verifies it and matches/creates a sandboxed GUEST, setting the same cookie session.
  const loginWithGoogle = async (credential: string) => {
    const res = await api.post<{ user: User }>('/auth/google', { credential });
    tokenStore.clear();
    setUser(res.user);
    await loadTenants();
  };

  const logout = () => {
    // Best-effort server-side revocation (bumps tokenVersion so the tokens can't be
    // reused elsewhere); clear locally regardless of the network result.
    setImpersonation(null);
    setImpersonating(null);
    api.post('/auth/logout').catch(() => {});
    tokenStore.clear();
    setUser(null);
    setTenants([]);
    setActiveTenantId(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, guestRegister, signupOrg, loginWithGoogle, logout, tenants, activeTenantId, switchTenant, impersonating, impersonate, stopImpersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
