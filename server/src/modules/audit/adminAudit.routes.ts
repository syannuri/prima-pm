import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';

// Admin-only GLOBAL audit trail — the one place an ADMIN can oversee ALL activity, including a
// guest's (the per-project audit at /projects/:id/audit is owner-scoped, so a guest's personal
// projects are otherwise invisible to admins). Read-only.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const ROLES = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER', 'GUEST'] as const;
const querySchema = z.object({
  scope: z.enum(['all', 'corporate', 'personal']).default('all'),
  entity: z.string().max(60).optional(),
  action: z.string().max(20).optional(),
  role: z.enum(ROLES).optional(), // filter by the actor's role
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);

    // "Personal" (guest) activity = the actor is a GUEST, OR the event happened on a personal
    // project. Personal projects are few, so we resolve their ids up front.
    const personalProjectIds = (
      await prisma.project.findMany({ where: { personalOwnerId: { not: null } }, select: { id: true } })
    ).map((p) => p.id);
    const personalCond: Prisma.AuditLogWhereInput = {
      OR: [{ user: { role: 'GUEST' } }, { projectId: { in: personalProjectIds } }],
    };

    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.role ? { user: { role: q.role } } : {}),
      ...(q.scope === 'personal' ? personalCond : q.scope === 'corporate' ? { NOT: personalCond } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          entity: true,
          entityId: true,
          action: true,
          createdAt: true,
          projectId: true,
          before: true,
          after: true,
          user: { select: { name: true, role: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Resolve project code/name/owner for the page's project ids (AuditLog has no Project relation).
    const pids = [...new Set(rows.map((r) => r.projectId).filter((v): v is string => !!v))];
    const projects = pids.length
      ? await prisma.project.findMany({ where: { id: { in: pids } }, select: { id: true, code: true, name: true, personalOwnerId: true } })
      : [];
    const pmap = new Map(projects.map((p) => [p.id, p]));

    const entries = rows.map((r) => {
      const proj = r.projectId ? pmap.get(r.projectId) : null;
      return {
        id: r.id,
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
        createdAt: r.createdAt,
        before: r.before ?? null,
        after: r.after ?? null,
        actor: r.user ? { name: r.user.name, role: r.user.role, email: r.user.email } : null,
        project: proj ? { code: proj.code, name: proj.name } : null,
        personal: (proj?.personalOwnerId ?? null) !== null || r.user?.role === 'GUEST',
      };
    });

    res.json({ entries, total, limit: q.limit, offset: q.offset });
  }),
);

export default router;
