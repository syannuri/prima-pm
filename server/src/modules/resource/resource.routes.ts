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
  deleteResource,
} from './resourceMaster.service.js';

const router = Router();
router.use(requireAuth);

// A guest works inside their PRIVATE pool (scoped to their user id); everyone else works on the
// corporate pool (personalOwnerId = null). This is what keeps the two data sets fully separated.
const ownerScope = (req: { user?: { id: string; role: string } }): string | null =>
  req.user?.role === 'GUEST' ? req.user.id : null;

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
    res.json(await listResources(req.query.all === '1' || req.query.all === 'true', ownerScope(req)));
  }),
);

// ADMIN/PMO curate the corporate pool; a GUEST curates their OWN private pool (scoped server-side).
router.post(
  '/',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  validateBody(resourceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ resource: await createResource(req.body, req.user!.id, ownerScope(req)) });
  }),
);

router.put(
  '/:id',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  validateBody(resourceSchema),
  asyncHandler(async (req, res) => {
    res.json({ resource: await updateResource(req.params.id, req.body, req.user!.id, ownerScope(req)) });
  }),
);

router.patch(
  '/:id/active',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json({ resource: await setResourceActive(req.params.id, req.body.isActive, req.user!.id, ownerScope(req)) });
  }),
);

// Adopt the linked rate card's current day-rate.
router.post(
  '/:id/refresh-rate',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  asyncHandler(async (req, res) => {
    res.json({ resource: await refreshResourceRate(req.params.id, req.user!.id, ownerScope(req)) });
  }),
);

// Hard-delete (owner-scoped). 409 if the resource is still in use.
router.delete(
  '/:id',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  asyncHandler(async (req, res) => {
    await deleteResource(req.params.id, req.user!.id, ownerScope(req));
    res.status(204).send();
  }),
);

export default router;
