import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';

const router = Router({ mergeParams: true });

const querySchema = z.object({
  entity: z.string().max(60).optional(),
  action: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// Which audit entities each role may see. `null` = all (no entity restriction).
// ADMIN/PMO (super users) and the owning PM see everything for the project;
// functional roles only see their own domain. Unknown roles see nothing.
const COST_ENTITIES = ['CostItemDirect', 'CostItemIndirect', 'ActualCostEntry', 'CostBaseline', 'RateCard'];
const ROLE_ENTITIES: Record<string, string[] | null> = {
  ADMIN: null,
  PMO: null,
  PROJECT_MANAGER: null,
  FINANCE: COST_ENTITIES,
  RISK_OFFICER: ['Risk'],
};

// Project-scoped audit trail (read access; functional roles see only their domain).
router.get(
  '/',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const role = req.user!.role;
    const roleEntities = role in ROLE_ENTITIES ? ROLE_ENTITIES[role] : [];

    // Combine the role's entity scope with any explicit entity filter from the UI.
    // A requested entity outside the role's scope must return nothing (sentinel).
    let entityCond: unknown;
    if (roleEntities && q.entity) entityCond = roleEntities.includes(q.entity) ? q.entity : '__forbidden__';
    else if (roleEntities) entityCond = { in: roleEntities };
    else if (q.entity) entityCond = q.entity;
    // Role scope (without the UI entity filter) — used for the dropdown list + total.
    const roleScope = roleEntities ? { entity: { in: roleEntities } } : {};

    const entries = await prisma.auditLog.findMany({
      where: {
        projectId: req.params.projectId,
        ...(entityCond !== undefined ? { entity: entityCond as never } : {}),
        ...(q.action ? { action: q.action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      select: {
        id: true,
        entity: true,
        entityId: true,
        action: true,
        createdAt: true,
        user: { select: { name: true, role: true } },
      },
    });

    // Distinct entities present within the role's scope (for the client filter dropdown).
    const distinct = await prisma.auditLog.findMany({
      where: { projectId: req.params.projectId, ...roleScope },
      select: { entity: true },
      distinct: ['entity'],
    });

    // Total recorded changes the role may see for this project (unaffected by UI filters).
    const total = await prisma.auditLog.count({ where: { projectId: req.params.projectId, ...roleScope } });

    res.json({ entries, entities: distinct.map((d) => d.entity).sort(), total });
  }),
);

export default router;
