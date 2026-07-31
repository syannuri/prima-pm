import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound, Conflict } from '../../lib/errors.js';

const router = Router();
router.use(requireAuth);

// A guest manages their PRIVATE rate cards and ADMIN/FINANCE the corporate ones — the two sets are
// now kept apart by TENANT scoping (a guest is their own tenant), so no owner scope is passed around.
const rateCardSchema = z.object({
  roleName: z.string().min(2).max(120),
  level: z.string().max(60).optional(),
  unitCostPerManday: z.coerce.number().positive(),
  isActive: z.boolean().optional(),
});

// Uniqueness of (roleName, level) is enforced within the caller's tenant (a guest may reuse a
// role/level name that corporate also uses — they're in different tenants). The findFirst is
// tenant-scoped, so no explicit owner filter is needed.
async function assertUniqueRole(roleName: string, level: string | null, excludeId?: string): Promise<void> {
  const clash = await prisma.rateCard.findFirst({
    where: { roleName, level, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw Conflict('A rate card with that role and level already exists');
}

// List rate cards for the caller's scope (guest → own, corporate → corporate). Needed by the
// manpower pickers too, so anyone authenticated may read WITHIN their scope. `?all=1` = inactive too.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const all = req.query.all === '1' || req.query.all === 'true';
    const rateCards = await prisma.rateCard.findMany({
      where: { ...(all ? {} : { isActive: true }) },
      orderBy: [{ roleName: 'asc' }, { level: 'asc' }],
    });
    res.json({ rateCards });
  }),
);

// ADMIN/FINANCE manage the corporate rate cards; a GUEST manages their OWN (scoped server-side).
router.post(
  '/',
  requireRole('ADMIN', 'FINANCE', 'GUEST'),
  validateBody(rateCardSchema),
  asyncHandler(async (req, res) => {
    const level = req.body.level ?? null;
    await assertUniqueRole(req.body.roleName, level);
    const rateCard = await prisma.rateCard.create({
      data: {
        roleName: req.body.roleName,
        level,
        unitCostPerManday: req.body.unitCostPerManday,
        isActive: req.body.isActive ?? true,
      },
    });
    await writeAudit({ userId: req.user!.id, entity: 'RateCard', entityId: rateCard.id, action: 'CREATE', after: rateCard });
    res.status(201).json({ rateCard });
  }),
);

router.put(
  '/:id',
  requireRole('ADMIN', 'FINANCE', 'GUEST'),
  validateBody(rateCardSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.rateCard.findFirst({ where: { id: req.params.id } });
    if (!existing) throw NotFound('Rate card not found');
    const level = req.body.level ?? null;
    await assertUniqueRole(req.body.roleName, level, existing.id);
    const rateCard = await prisma.rateCard.update({
      where: { id: req.params.id },
      data: {
        roleName: req.body.roleName,
        level,
        unitCostPerManday: req.body.unitCostPerManday,
        isActive: req.body.isActive ?? existing.isActive,
      },
    });
    await writeAudit({ userId: req.user!.id, entity: 'RateCard', entityId: rateCard.id, action: 'UPDATE', before: existing, after: rateCard });
    res.json({ rateCard });
  }),
);

// Activate / deactivate without resending the whole card.
router.patch(
  '/:id/active',
  requireRole('ADMIN', 'FINANCE', 'GUEST'),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.rateCard.findFirst({ where: { id: req.params.id } });
    if (!existing) throw NotFound('Rate card not found');
    const rateCard = await prisma.rateCard.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
    await writeAudit({ userId: req.user!.id, entity: 'RateCard', entityId: rateCard.id, action: 'UPDATE', before: existing, after: rateCard });
    res.json({ rateCard });
  }),
);

// Hard-delete (owner-scoped). Blocked while the card is still linked to resources or cost lines —
// those keep a snapshot rate but reference the card, so deactivate instead of orphaning them.
router.delete(
  '/:id',
  requireRole('ADMIN', 'FINANCE', 'GUEST'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.rateCard.findFirst({ where: { id: req.params.id } });
    if (!existing) throw NotFound('Rate card not found');
    const [resCount, lineCount] = await Promise.all([
      prisma.resource.count({ where: { rateCardId: req.params.id } }),
      prisma.costItemDirect.count({ where: { rateCardId: req.params.id } }),
    ]);
    if (resCount + lineCount > 0) {
      throw Conflict('This rate card is linked to resources or cost lines — deactivate it instead of deleting.');
    }
    await prisma.rateCard.delete({ where: { id: req.params.id } });
    await writeAudit({ userId: req.user!.id, entity: 'RateCard', entityId: req.params.id, action: 'DELETE', before: existing });
    res.status(204).send();
  }),
);

export default router;
