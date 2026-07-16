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

// A guest manages their PRIVATE rate cards (scoped to their user id); ADMIN/FINANCE manage the
// corporate ones (personalOwnerId = null). The two sets never mix.
const ownerScope = (req: { user?: { id: string; role: string } }): string | null =>
  req.user?.role === 'GUEST' ? req.user.id : null;

const rateCardSchema = z.object({
  roleName: z.string().min(2).max(120),
  level: z.string().max(60).optional(),
  unitCostPerManday: z.coerce.number().positive(),
  isActive: z.boolean().optional(),
});

// Uniqueness of (roleName, level) is enforced per owner scope (was a global DB constraint; a guest
// may reuse a role/level name that corporate also uses). Guarded here at the application layer.
async function assertUniqueRole(roleName: string, level: string | null, ownerId: string | null, excludeId?: string): Promise<void> {
  const clash = await prisma.rateCard.findFirst({
    where: { roleName, level, personalOwnerId: ownerId, ...(excludeId ? { id: { not: excludeId } } : {}) },
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
      where: { personalOwnerId: ownerScope(req), ...(all ? {} : { isActive: true }) },
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
    const ownerId = ownerScope(req);
    const level = req.body.level ?? null;
    await assertUniqueRole(req.body.roleName, level, ownerId);
    const rateCard = await prisma.rateCard.create({
      data: {
        roleName: req.body.roleName,
        level,
        unitCostPerManday: req.body.unitCostPerManday,
        isActive: req.body.isActive ?? true,
        personalOwnerId: ownerId,
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
    const ownerId = ownerScope(req);
    const existing = await prisma.rateCard.findFirst({ where: { id: req.params.id, personalOwnerId: ownerId } });
    if (!existing) throw NotFound('Rate card not found');
    const level = req.body.level ?? null;
    await assertUniqueRole(req.body.roleName, level, ownerId, existing.id);
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
    const existing = await prisma.rateCard.findFirst({ where: { id: req.params.id, personalOwnerId: ownerScope(req) } });
    if (!existing) throw NotFound('Rate card not found');
    const rateCard = await prisma.rateCard.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
    await writeAudit({ userId: req.user!.id, entity: 'RateCard', entityId: rateCard.id, action: 'UPDATE', before: existing, after: rateCard });
    res.json({ rateCard });
  }),
);

export default router;
