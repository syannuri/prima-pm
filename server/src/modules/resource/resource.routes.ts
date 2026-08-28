import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { getResourceCapacity } from './resource.service.js';
import { detectConflicts, draftReallocation, reallocationAiAvailable, type Conflict } from './resourceConflicts.service.js';
import { aiEnabled } from '../../lib/ai.js';
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

// A guest works inside their PRIVATE pool and everyone else on the corporate pool — the two are now
// kept apart by TENANT scoping (a guest is their own tenant), so the service no longer needs an owner
// scope passed in.
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

// Resource over-allocation conflicts (deterministic) + whether the advisory AI is usable. Scoped
// like /capacity. `aiAvailable` drives the "Suggest fix with AI" button's visibility.
router.get(
  '/conflicts',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const [conflicts, aiAvailable] = await Promise.all([
      detectConflicts(req.user!.id, req.user!.role, q),
      reallocationAiAvailable(),
    ]);
    res.json({ conflicts, aiAvailable });
  }),
);

// AI reallocation DRAFT for one conflict (env-gated 503 + tenant opt-in 403 in the service). The
// body is a conflict as returned by GET /conflicts; the service grounds moves against it.
const conflictBody = z.object({
  resourceKey: z.string(), resourceName: z.string(), personnelRole: z.string().nullable(),
  period: z.string(), allocated: z.number(), capacity: z.number(), utilization: z.number(), overBy: z.number(),
  contributions: z.array(z.object({ costItemId: z.string(), taskName: z.string(), projectId: z.string(), projectCode: z.string(), planMandaysInPeriod: z.number() })),
  candidates: z.array(z.object({ resourceId: z.string(), name: z.string(), personnelRole: z.string().nullable(), utilization: z.number(), spareCapacity: z.number() })),
});
router.post(
  '/conflicts/ai-draft',
  validateBody(conflictBody),
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    res.json(await draftReallocation(req.body as Conflict));
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

// ADMIN/PMO curate the corporate pool; a GUEST curates their OWN private pool (scoped server-side).
router.post(
  '/',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  validateBody(resourceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ resource: await createResource(req.body, req.user!.id) });
  }),
);

router.put(
  '/:id',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  validateBody(resourceSchema),
  asyncHandler(async (req, res) => {
    res.json({ resource: await updateResource(req.params.id, req.body, req.user!.id) });
  }),
);

router.patch(
  '/:id/active',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json({ resource: await setResourceActive(req.params.id, req.body.isActive, req.user!.id) });
  }),
);

// Adopt the linked rate card's current day-rate.
router.post(
  '/:id/refresh-rate',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  asyncHandler(async (req, res) => {
    res.json({ resource: await refreshResourceRate(req.params.id, req.user!.id) });
  }),
);

// Hard-delete (owner-scoped). 409 if the resource is still in use.
router.delete(
  '/:id',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  asyncHandler(async (req, res) => {
    await deleteResource(req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
