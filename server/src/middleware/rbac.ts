import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { Forbidden, Unauthorized, NotFound } from '../lib/errors.js';

// Roles that can see/administer every project regardless of ownership.
const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];

// Guard: user must hold one of the allowed roles.
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw Unauthorized();
    if (!allowed.includes(req.user.role)) {
      throw Forbidden(`Requires role: ${allowed.join(' | ')}`);
    }
    next();
  };
}

// Guard: user can access a specific project.
// ADMIN/PMO -> all projects. Others -> only projects they manage (pmUserId).
// `allowRoles` lets functional roles (e.g. FINANCE, RISK_OFFICER) bypass ownership
// for their domain routes. Reads :projectId (or :id) from route params.
export function requireProjectAccess(opts: { write?: boolean; allowRoles?: Role[] } = {}) {
  // Async middleware: Express v4 does not catch rejected promises, so we must
  // catch internally and forward errors via next(err) (otherwise a denied
  // request becomes an unhandled rejection and crashes the process).
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw Unauthorized();
      const projectId = req.params.projectId ?? req.params.id;
      if (!projectId) throw NotFound('Project id missing in route');

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, pmUserId: true, status: true, deletedAt: true },
      });
      // A soft-deleted project must be treated as gone for every nested route,
      // not just the top-level project endpoints (otherwise its cost/risk/
      // schedule/attachment data stays readable + writable after "deletion").
      if (!project || project.deletedAt) {
        throw NotFound('Project not found');
      }

      const isGlobal = GLOBAL_ROLES.includes(req.user.role);
      const isAllowedFunctional = opts.allowRoles?.includes(req.user.role) ?? false;
      const isOwner = project.pmUserId === req.user.id;

      if (!isGlobal && !isAllowedFunctional && !isOwner) {
        throw Forbidden('You do not have access to this project');
      }

      // Write access: VIEWER and TEAM_MEMBER may never write at the project level here.
      if (opts.write && req.user.role === 'VIEWER') {
        throw Forbidden('Read-only role cannot modify project data');
      }

      // Expose the loaded project to downstream handlers.
      (req as Request & { project?: typeof project }).project = project;
      next();
    } catch (err) {
      next(err);
    }
  };
}
