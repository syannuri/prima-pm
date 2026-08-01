import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { Unauthorized, Forbidden } from '../lib/errors.js';

// Platform (super-admin) gate: a global privilege that transcends tenants (create/suspend tenants,
// impersonate, edit DEPLOYMENT-level settings like the open sign-up toggles). Resolved FRESH from the
// DB each request — never trusted from the token — so a revoked flag takes effect immediately.
// Must run after requireAuth (needs req.user).
export async function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw Unauthorized();
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { isPlatformAdmin: true } });
    if (!u?.isPlatformAdmin) throw Forbidden('Platform administrators only');
    next();
  } catch (e) {
    next(e);
  }
}
