import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';

const router = Router();
router.use(requireAuth);

const rateCardSchema = z.object({
  roleName: z.string().min(2).max(120),
  level: z.string().max(60).optional(),
  unitCostPerManday: z.coerce.number().positive(),
  isActive: z.boolean().optional(),
});

// Anyone authenticated can read the rate card (needed for manpower pickers).
// `?all=1` includes inactive cards (for admin management).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const all = req.query.all === '1' || req.query.all === 'true';
    const rateCards = await prisma.rateCard.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [{ roleName: 'asc' }, { level: 'asc' }],
    });
    res.json({ rateCards });
  }),
);

// Only ADMIN/FINANCE manage the master rate card.
router.post(
  '/',
  requireRole('ADMIN', 'FINANCE'),
  validateBody(rateCardSchema),
  asyncHandler(async (req, res) => {
    const rateCard = await prisma.rateCard.create({
      data: {
        roleName: req.body.roleName,
        level: req.body.level ?? null,
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
  requireRole('ADMIN', 'FINANCE'),
  validateBody(rateCardSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.rateCard.findUnique({ where: { id: req.params.id } });
    if (!existing) throw NotFound('Rate card not found');
    const rateCard = await prisma.rateCard.update({
      where: { id: req.params.id },
      data: {
        roleName: req.body.roleName,
        level: req.body.level ?? null,
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
  requireRole('ADMIN', 'FINANCE'),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.rateCard.findUnique({ where: { id: req.params.id } });
    if (!existing) throw NotFound('Rate card not found');
    const rateCard = await prisma.rateCard.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
    await writeAudit({ userId: req.user!.id, entity: 'RateCard', entityId: rateCard.id, action: 'UPDATE', before: existing, after: rateCard });
    res.json({ rateCard });
  }),
);

export default router;
