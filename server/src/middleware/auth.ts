import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt.js';
import { Unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { AT_COOKIE } from '../lib/cookies.js';
import { bindTenantContext, multitenancyEnforced } from '../lib/tenant/context.js';

// Authenticated user attached to the request by requireAuth.
export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  tid?: string; // active tenant (pooled multitenancy); present once tokens carry `tid`
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
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
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
      select: { id: true, role: true, email: true, isActive: true, tokenVersion: true },
    });
    if (!user || !user.isActive) throw Unauthorized('Session is no longer valid');
    if ((payload.tv ?? 0) !== user.tokenVersion) throw Unauthorized('Session has been revoked');

    // Role is resolved FRESH from the DB each request so changes apply at once. Under enforcement
    // it's the active tenant's MEMBERSHIP role (Phase 4), not the global User.role — read here (not
    // trusted from the token) for the same reason. A stale token whose membership was revoked is
    // rejected. With enforcement off, the global role stands (single-tenant behaviour unchanged).
    let role = user.role;
    if (multitenancyEnforced() && payload.tid) {
      const membership = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: payload.tid } },
        select: { role: true },
      });
      if (!membership) throw Unauthorized('No membership in the active tenant');
      role = membership.role;
    }

    req.user = { id: user.id, role, email: user.email, tid: payload.tid };

    // Establish the request-scoped tenant context so the Prisma extension scopes every query.
    if (multitenancyEnforced()) {
      // A token minted before enforcement (or before a membership existed) carries no `tid`.
      // Reject with 401 rather than proceeding context-less (which would fail-closed to a 500 on
      // scoped routes): the client auto-refreshes on 401, and /auth/refresh re-mints a tenant-
      // pinned token — so the transition is seamless, no forced logout. Wrapping next() runs the
      // whole downstream chain inside the tenant's AsyncLocalStorage scope.
      if (!payload.tid) throw Unauthorized('Session needs a tenant — refreshing');
      bindTenantContext(payload.tid, () => next());
    } else {
      next();
    }
  } catch (err) {
    next(err);
  }
}
