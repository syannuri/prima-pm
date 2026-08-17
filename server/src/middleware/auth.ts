import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt.js';
import { Unauthorized, Forbidden, PaymentRequired } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { AT_COOKIE } from '../lib/cookies.js';
import { bindTenantContext, multitenancyEnforced, runAsSystem } from '../lib/tenant/context.js';
import { isTrialExpired } from '../lib/tenant/trial.js';
import { enforceTenantRate, enforceApiKeyRate } from './rateLimit.js';
import { hashApiKey, looksLikeApiKey } from '../lib/apiKey.js';
import { writeAudit } from '../lib/audit.js';

// Authenticated user attached to the request by requireAuth.
export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  tid?: string; // active tenant (pooled multitenancy); present once tokens carry `tid`
  // True when the active tenant is a guest's personal sandbox. The tenant-native replacement for the
  // project's `personalOwnerId`: in a personal tenant the sole member self-governs their own projects
  // (rbac). Resolved fresh from the membership's tenant below, only under enforcement.
  tenantIsPersonal?: boolean;
  // True when a platform super-admin is IMPERSONATING inside this tenant (not a real member).
  impersonating?: boolean;
  // True when the caller authenticated with a public API key (Bearer pk_...) rather than a session.
  isApiKey?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      // Set when the request authenticated via a public API key. tenantId is null only on a
      // single-tenant deploy (enforcement off), where keys aren't tenant-scoped.
      apiKey?: { id: string; tenantId: string | null };
    }
  }
}

// Mutating methods are refused for API-key callers in T3.1 — the public API is read-only for now
// (write scopes + a service-principal actor come in a later ticket). Session/impersonation auth is
// unaffected.
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Routes a TRIAL-EXPIRED workspace may still reach (full lockout otherwise): auth (read session state /
// log out / switch tenant) and billing (so the admin can actually upgrade). Everything else 402-walls.
function trialWallAllows(req: Request): boolean {
  const url = req.originalUrl.split('?')[0];
  return url.startsWith('/api/v1/auth/') || url.startsWith('/api/v1/billing');
}

// Authenticate a `Bearer pk_...` request: resolve the key by its hash (context-less, so via
// runAsSystem — the key is what SELECTS the tenant), then act as a synthetic principal with the
// key's role inside its tenant and bind the tenant context so the Prisma extension isolates it.
async function authenticateWithApiKey(token: string, req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!READ_ONLY_METHODS.has(req.method)) throw Forbidden('API keys are read-only');

  const key = await runAsSystem(() => prisma.apiKey.findUnique({
    where: { hashedKey: hashApiKey(token) },
    select: { id: true, tenantId: true, role: true, lastUsedAt: true, revokedAt: true, expiresAt: true, tenant: { select: { status: true, isPersonal: true } } },
  }));
  if (!key || key.revokedAt) throw Unauthorized('Invalid API key');
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) throw Unauthorized('API key has expired');
  // Tenant checks apply only to a tenant-bound key (single-tenant deploys run enforcement-off, where
  // tenantId is null and the row isn't scoped — see below).
  if (key.tenant && key.tenant.status !== 'ACTIVE') throw Forbidden('This workspace is not active.');
  // Domain pinning: a key issued for tenant A may not be used on tenant B's subdomain/custom domain.
  if (req.hostTenant && key.tenantId && req.hostTenant.id !== key.tenantId) throw Forbidden('This API key is for a different workspace than this domain.');

  // Per-key throughput budget (throws 429 + Retry-After when exceeded).
  enforceApiKeyRate(key.id, res);

  req.user = { id: `apikey:${key.id}`, role: key.role, email: `apikey:${key.id}`, tid: key.tenantId ?? undefined, tenantIsPersonal: key.tenant?.isPersonal ?? false, isApiKey: true };
  req.apiKey = { id: key.id, tenantId: key.tenantId };
  // Best-effort, throttled "last used" stamp (skip if updated within the last 5 min) — never blocks.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 5 * 60 * 1000) {
    void runAsSystem(() => prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })).catch(() => {});
  }

  // Append an access record to the audit trail (fire-and-forget; never blocks). Written inside the
  // bound context so AuditLog.tenantId is stamped; the no-context branch falls back to system.
  const audit = () => void writeAudit({ userId: null, entity: 'ApiKey', entityId: key.id, action: 'API_ACCESS', after: { method: req.method, path: req.path } });

  // Under enforcement a key MUST be tenant-bound — scope the request to its tenant. With enforcement
  // off (single-tenant deploy) there's no tenant to bind; the key just authenticates.
  if (multitenancyEnforced()) {
    if (!key.tenantId || !key.tenant) throw Unauthorized('Invalid API key');
    enforceTenantRate(key.tenantId, res);
    bindTenantContext(key.tenantId, key.tenant.isPersonal, () => { audit(); next(); });
  } else {
    audit();
    next();
  }
}

// Verifies the Bearer access token AND revalidates the account against the DB on every
// request: the user must still exist and be active, and the token's version must match
// User.tokenVersion (so logout / password change / deactivation revoke tokens immediately).
// Role is taken from the DB, not the token, so role changes take effect at once.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Prefer the Authorization header (used by automation / the JWT-mint test workflow);
    // fall back to the httpOnly prima_at cookie (the browser SPA's credential — kept out of
    // JS so an XSS can't read it).
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : req.cookies?.[AT_COOKIE];
    if (!token) throw Unauthorized('Missing authentication');

    // A public API key (Bearer pk_...) authenticates differently from a JWT session — resolve it
    // and (when it binds tenant context) run the rest of the chain inside that scope, then return.
    if (looksLikeApiKey(token)) {
      await authenticateWithApiKey(token, req, res, next);
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw Unauthorized('Invalid or expired access token');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, email: true, isActive: true, tokenVersion: true, isPlatformAdmin: true },
    });
    if (!user || !user.isActive) throw Unauthorized('Session is no longer valid');
    if ((payload.tv ?? 0) !== user.tokenVersion) throw Unauthorized('Session has been revoked');

    // Subdomain / custom-domain routing (Phase 6): when the Host maps to a specific workspace, a
    // session pinned to a DIFFERENT workspace may not be used on it (prevents tenant A's token being
    // replayed on tenant B's domain). No-op unless APP_BASE_DOMAIN is set + the host matches a tenant.
    if (req.hostTenant && payload.tid && payload.tid !== req.hostTenant.id) {
      throw Forbidden('This session is for a different workspace than this domain.');
    }

    // Role is resolved FRESH from the DB each request so changes apply at once. Under enforcement
    // it's the active tenant's MEMBERSHIP role (Phase 4), not the global User.role — read here (not
    // trusted from the token) for the same reason. A stale token whose membership was revoked is
    // rejected. With enforcement off, the global role stands (single-tenant behaviour unchanged).
    let role = user.role;
    let tenantIsPersonal = false;
    let impersonating = false;
    if (multitenancyEnforced() && payload.imp && payload.tid) {
      // IMPERSONATION: a platform super-admin acting inside a tenant they need not be a member of.
      // Re-verify the caller is STILL a platform admin (a revoked flag ends impersonation at once);
      // the role + tenant come from the gated-minted token. Corporate tenants only.
      if (!user.isPlatformAdmin) throw Forbidden('Impersonation requires platform admin');
      const tenant = await prisma.tenant.findUnique({ where: { id: payload.tid }, select: { isPersonal: true } });
      if (!tenant || tenant.isPersonal) throw Forbidden('Cannot impersonate this workspace');
      role = payload.role;
      impersonating = true;
    } else if (multitenancyEnforced() && payload.tid) {
      const membership = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: payload.tid } },
        select: { role: true, tenant: { select: { isPersonal: true, status: true, plan: true, trialEndsAt: true } } },
      });
      if (!membership) throw Unauthorized('No membership in the active tenant');
      // Only an ACTIVE tenant admits its members. SUSPENDED = platform super-admin lockout; PENDING /
      // REJECTED = a self-serve signup not (yet) approved. A session should never be pinned to a
      // non-ACTIVE tenant (issueTokenPair excludes them) — this is the fail-closed backstop.
      if (membership.tenant.status !== 'ACTIVE') {
        if (membership.tenant.status === 'PENDING') throw Forbidden('This workspace is awaiting approval.');
        throw Forbidden(membership.tenant.status === 'SUSPENDED' ? 'This workspace is suspended.' : 'This workspace is not active.');
      }
      role = membership.role;
      tenantIsPersonal = membership.tenant.isPersonal;

      // Trial upgrade wall (full lockout): a corporate workspace whose 60-day trial has ended is
      // 402-locked out of everything except auth + billing, so the admin can still read session state,
      // log out, and upgrade. Personal (guest) tenants are exempt. No-op until a trial deadline is past.
      if (!tenantIsPersonal && isTrialExpired(membership.tenant.plan, membership.tenant.trialEndsAt) && !trialWallAllows(req)) {
        throw PaymentRequired('Your trial has ended. Upgrade to a paid plan to continue.');
      }
    }

    req.user = { id: user.id, role, email: user.email, tid: payload.tid, tenantIsPersonal, impersonating };

    // Establish the request-scoped tenant context so the Prisma extension scopes every query.
    if (multitenancyEnforced()) {
      // A token minted before enforcement (or before a membership existed) carries no `tid`.
      // Reject with 401 rather than proceeding context-less (which would fail-closed to a 500 on
      // scoped routes): the client auto-refreshes on 401, and /auth/refresh re-mints a tenant-
      // pinned token — so the transition is seamless, no forced logout. Wrapping next() runs the
      // whole downstream chain inside the tenant's AsyncLocalStorage scope.
      if (!payload.tid) throw Unauthorized('Session needs a tenant — refreshing');
      // Per-tenant throughput budget — one workspace can't monopolize the shared server (throws 429).
      enforceTenantRate(payload.tid, res);
      bindTenantContext(payload.tid, tenantIsPersonal, () => next());
    } else {
      next();
    }
  } catch (err) {
    next(err);
  }
}
