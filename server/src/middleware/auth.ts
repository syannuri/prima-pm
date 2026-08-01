import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt.js';
import { Unauthorized, Forbidden } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { AT_COOKIE } from '../lib/cookies.js';
import { bindTenantContext, multitenancyEnforced } from '../lib/tenant/context.js';
import { enforceTenantRate } from './rateLimit.js';

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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
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
        select: { role: true, tenant: { select: { isPersonal: true, status: true } } },
      });
      if (!membership) throw Unauthorized('No membership in the active tenant');
      // A SUSPENDED tenant (platform super-admin action) locks out all its members.
      if (membership.tenant.status === 'SUSPENDED') throw Forbidden('This workspace is suspended.');
      role = membership.role;
      tenantIsPersonal = membership.tenant.isPersonal;
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
