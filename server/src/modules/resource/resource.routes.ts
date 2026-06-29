import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { getResourceCapacity } from './resource.service.js';
import {
  listResources,
  createResource,
  updateResource,
  setResourceActive,
  refreshResourceRate,
} from './resourceMaster.service.js';

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  granularity: z.enum(['week', 'month']).optional(),
});

// Cross-project resource capacity / over-allocation, scoped to the caller's visible projects.
router.get(
  '/capacity',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const report = await getResourceCapacity(req.user!.id, req.user!.role, q);
    res.json(report);
  }),
);

// ---- Resource master (manpower pool) ----
const resourceSchema = z.object({
  name: z.string().min(1).max(160),
  resourceType: z.enum(['NAMED', 'GENERIC']).optional(),
  roleTitle: z.string().max(120).optional().nullable(),
  personnelRole: z.enum(['PM', 'PROJECT_PERSONNEL']).optional(),
  rateCardId: z.string().uuid().optional().nullable(),
  unitCostPerManday: z.coerce.number().nonnegative().optional(),
  capacityPerDay: z.coerce.number().positive().max(100).optional(),
  department: z.string().max(120).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

// List the master pool. `?all=1` includes inactive (for admin management).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listResources(req.query.all === '1' || req.query.all === 'true'));
  }),
);

// Only ADMIN/PMO curate the resource pool.
router.post(
  '/',
  requireRole('ADMIN', 'PMO'),
  validateBody(resourceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ resource: await createResource(req.body, req.user!.id) });
  }),
);

router.put(
  '/:id',
  requireRole('ADMIN', 'PMO'),
  validateBody(resourceSchema),
  asyncHandler(async (req, res) => {
    res.json({ resource: await updateResource(req.params.id, req.body, req.user!.id) });
  }),
);

router.patch(
  '/:id/active',
  requireRole('ADMIN', 'PMO'),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json({ resource: await setResourceActive(req.params.id, req.body.isActive, req.user!.id) });
  }),
);

// Adopt the linked rate card's current day-rate.
router.post(
  '/:id/refresh-rate',
  requireRole('ADMIN', 'PMO'),
  asyncHandler(async (req, res) => {
    res.json({ resource: await refreshResourceRate(req.params.id, req.user!.id) });
  }),
);

export default router;
