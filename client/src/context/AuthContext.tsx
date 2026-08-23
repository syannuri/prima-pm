import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore, migrateLegacyTokens, setImpersonation } from '../api/client';
import type { User, TenantSummary, Workspace, PlanFeature } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, captchaToken?: string) => Promise<void>;
  // Resolves to a verify marker when the deployment has the email-activation wall armed (no session
  // yet — the user must confirm their email), else void (auto-logged-in, session set).
  guestRegister: (name: string, email: string, password: string, captchaToken?: string) => Promise<{ verify: true; email: string } | void>;
  signupOrg: (orgName: string, ownerName: string, email: string, password: string, captchaToken?: string) => Promise<{ pending: true; orgName: string; slug: string }>;
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
  // Active workspace plan + trial state + capabilities (from /auth/me). Null on single-tenant deploys.
  // Drives the trial-countdown banner, the upgrade wall, and per-feature UI locks.
  workspace: Workspace | null;
  hasFeature: (feature: PlanFeature) => boolean;
  // Merge a partial update into the cached user (e.g. after saving a self-service preference) so the
  // UI reflects it immediately without a full /auth/me round-trip.
  patchUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<{ tenantId: string; name: string } | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  // Pull the active workspace's plan/trial/capabilities (best-effort; leaves it null on failure or on
  // single-tenant deploys, which hides the banner/wall).
  const loadWorkspace = async () => {
    try {
      const r = await api.get<{ workspace: Workspace | null }>('/auth/me');
      setWorkspace(r.workspace ?? null);
    } catch {
      setWorkspace(null);
    }
  };

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
        const r = await api.get<{ user: User; workspace: Workspace | null }>('/auth/me');
        setUser(r.user);
        setWorkspace(r.workspace ?? null);
        await loadTenants();
      } catch {
        tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // A mid-session trial expiry surfaces as a 402 from the api client (see api/client.ts), which
  // dispatches this event. Flip the workspace to expired so the upgrade wall renders at once, without
  // waiting for the next /auth/me.
  useEffect(() => {
    const onExpired = () => setWorkspace((w) => (w && !w.trialExpired ? { ...w, trialExpired: true } : w));
    window.addEventListener('trial-expired', onExpired);
    return () => window.removeEventListener('trial-expired', onExpired);
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
    try { const r = await api.get<{ user: User; workspace: Workspace | null }>('/auth/me'); setUser(r.user); setWorkspace(r.workspace ?? null); } catch { /* keep prior */ }
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
    await loadWorkspace();
  };

  // Self-service guest signup. Normally the server auto-logs-in (cookie flow, like login). But when the
  // email-activation wall is armed it returns { verify:true } with NO session — the account must be
  // activated from the emailed link first — so we surface that marker instead of setting a user.
  const guestRegister = async (name: string, email: string, password: string, captchaToken?: string) => {
    const res = await api.post<{ user?: User; verify?: true; email?: string }>('/auth/guest/register', { name, email, password, captchaToken });
    if (res.verify) return { verify: true as const, email: res.email ?? email };
    tokenStore.clear();
    setUser(res.user!);
    await loadTenants();
    await loadWorkspace();
  };

  // Self-serve organization signup (option C — manual approval): creates a PENDING corporate tenant +
  // owner admin. Does NOT log in — the owner must wait for a platform admin to approve. Returns the
  // pending marker so the UI can show a "waiting for approval" screen instead of routing to a session.
  const signupOrg = async (orgName: string, ownerName: string, email: string, password: string, captchaToken?: string) => {
    return api.post<{ pending: true; orgName: string; slug: string }>('/auth/signup', { orgName, ownerName, email, password, captchaToken });
  };

  // Sign in with Google — post the ID token (credential) from Google Identity Services; the
  // server verifies it and matches/creates a sandboxed GUEST, setting the same cookie session.
  const loginWithGoogle = async (credential: string) => {
    const res = await api.post<{ user: User }>('/auth/google', { credential });
    tokenStore.clear();
    setUser(res.user);
    await loadTenants();
    await loadWorkspace();
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
    setWorkspace(null);
  };

  // A feature is available when the deployment is single-tenant (workspace null ⇒ no plan gating) or
  // the active plan's capability set includes it.
  const hasFeature = (feature: PlanFeature) => !workspace || workspace.capabilities.includes(feature);

  const patchUser = (patch: Partial<User>) => setUser((u) => (u ? { ...u, ...patch } : u));

  return (
    <AuthContext.Provider value={{ user, loading, login, guestRegister, signupOrg, loginWithGoogle, logout, tenants, activeTenantId, switchTenant, impersonating, impersonate, stopImpersonating, workspace, hasFeature, patchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
