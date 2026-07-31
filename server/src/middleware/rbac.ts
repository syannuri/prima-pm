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

      // ADMIN/PMO global, functional roles for their domain routes, otherwise the owning PM. A guest
      // in their personal tenant is the pmUserId owner of their own projects, so this ownership rule
      // grants them access; a guest sandbox is kept from corporate users (and vice-versa) by TENANT
      // scoping — a cross-tenant project simply doesn't load (404 above), so no personalOwnerId check
      // is needed here.
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

      // A CLOSED project is frozen: no nested data (cost, schedule, risk, timesheet,
      // charter, attachments…) may be mutated — governance/audit integrity. Reopen the
      // project (ADMIN/PMO, with a reason) to make changes. The top-level status route
      // uses requireRole only (not this guard), so reopening is still possible.
      if (opts.write && project.status === 'CLOSED') {
        throw Forbidden('This project is closed and read-only. Reopen it to make changes.');
      }

      // Expose the loaded project to downstream handlers.
      (req as Request & { project?: typeof project }).project = project;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Guard for GOVERNANCE actions on a project (commit charter, set/lock baseline, activate/
// hold/resume/close, delete). In a PERSONAL (guest) tenant the sole member self-governs their own
// projects — no approval matrix. For a corporate project the actor must hold one of `corporateRoles`
// (typically ADMIN/PMO, sometimes + PROJECT_MANAGER). Loads the project from :projectId / :id, so it
// replaces a plain requireRole() on these routes. (Whether the project is a personal sandbox is now
// read from the active TENANT — req.user.tenantIsPersonal — the tenant-native replacement for the
// project's personalOwnerId; tenant scoping already blocks cross-tenant reach.)
export function requireProjectGovernance(...corporateRoles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw Unauthorized();
      const projectId = req.params.projectId ?? req.params.id;
      if (!projectId) throw NotFound('Project id missing in route');
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) throw NotFound('Project not found');
      if (req.user.tenantIsPersonal) {
        // Personal (guest) tenant: the sole member self-governs their own project, no approval matrix.
      } else if (!corporateRoles.includes(req.user.role)) {
        throw Forbidden(`Requires role: ${corporateRoles.join(' | ')}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
