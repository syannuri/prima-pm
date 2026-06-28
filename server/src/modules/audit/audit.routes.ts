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

// Project-scoped audit trail (read access; functional roles included for transparency).
router.get(
  '/',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const entries = await prisma.auditLog.findMany({
      where: {
        projectId: req.params.projectId,
        ...(q.entity ? { entity: q.entity } : {}),
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

    // Distinct entities/actions present (for client-side filter dropdowns).
    const distinct = await prisma.auditLog.findMany({
      where: { projectId: req.params.projectId },
      select: { entity: true },
      distinct: ['entity'],
    });

    // Total number of recorded changes for this project (unaffected by filters).
    const total = await prisma.auditLog.count({ where: { projectId: req.params.projectId } });

    res.json({ entries, entities: distinct.map((d) => d.entity).sort(), total });
  }),
);

export default router;
