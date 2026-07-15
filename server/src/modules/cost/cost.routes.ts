import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import {
  directLineSchema,
  indirectLineSchema,
  managementReserveSchema,
  actualCostSchema,
  autoPostLabourSchema,
} from './cost.schemas.js';
import * as svc from './cost.service.js';

const router = Router({ mergeParams: true });

// Writers for cost: PM (owner), PMO, ADMIN, FINANCE (functional, cross-project).
const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
const canWrite = [
  requireProjectAccess({ write: true, allowRoles: ['FINANCE'] }),
  requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE'),
];

// Summary: direct + indirect lines, baseline roll-up, charter variance source.
router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const summary = await svc.getCostSummary(req.params.projectId);
    res.json(summary);
  }),
);

// Recompute baseline on demand (e.g. after risks change).
router.post(
  '/recompute',
  ...canWrite,
  asyncHandler(async (req, res) => {
    const baseline = await svc.recomputeBaseline(req.params.projectId);
    res.json({ baseline });
  }),
);

// --- Direct cost lines ---
router.post(
  '/direct',
  ...canWrite,
  validateBody(directLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.addDirectLine(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ line });
  }),
);

router.put(
  '/direct/:itemId',
  ...canWrite,
  validateBody(directLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.updateDirectLine(req.params.projectId, req.params.itemId, req.body, req.user!.id);
    res.json({ line });
  }),
);

router.delete(
  '/direct/:itemId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteDirectLine(req.params.projectId, req.params.itemId, req.user!.id);
    res.status(204).send();
  }),
);

// --- Indirect cost lines ---
router.post(
  '/indirect',
  ...canWrite,
  validateBody(indirectLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.addIndirectLine(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ line });
  }),
);

router.put(
  '/indirect/:itemId',
  ...canWrite,
  validateBody(indirectLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.updateIndirectLine(req.params.projectId, req.params.itemId, req.body, req.user!.id);
    res.json({ line });
  }),
);

router.delete(
  '/indirect/:itemId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteIndirectLine(req.params.projectId, req.params.itemId, req.user!.id);
    res.status(204).send();
  }),
);

// --- Actual Cost entries (time-phased, feeds EVM CPI) ---
router.get(
  '/actuals',
  canRead,
  asyncHandler(async (req, res) => {
    const actuals = await svc.listActualCosts(req.params.projectId);
    res.json({ actuals });
  }),
);

router.post(
  '/actuals',
  ...canWrite,
  validateBody(actualCostSchema),
  asyncHandler(async (req, res) => {
    const entry = await svc.addActualCost(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ entry });
  }),
);

// One-click: fill Actual Cost from logged timesheets (Σ md × day-rate). Idempotent —
// replaces its own prior auto entry; manual AC entries are untouched.
router.post(
  '/actuals/fill-from-timesheet',
  ...canWrite,
  asyncHandler(async (req, res) => {
    const result = await svc.fillActualCostFromTimesheet(req.params.projectId, req.user!.id);
    res.status(201).json(result);
  }),
);

// Toggle auto-posting of labour AC: when on, each man-day mutation re-syncs the labour AC
// entry. Turning it on syncs immediately.
router.patch(
  '/auto-post-labour',
  ...canWrite,
  validateBody(autoPostLabourSchema),
  asyncHandler(async (req, res) => {
    const result = await svc.setAutoPostLabourAc(req.params.projectId, req.body.enabled, req.user!.id);
    res.json(result);
  }),
);

router.delete(
  '/actuals/:entryId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteActualCost(req.params.projectId, req.params.entryId, req.user!.id);
    res.status(204).send();
  }),
);

// --- Management reserve ---
router.patch(
  '/management-reserve',
  ...canWrite,
  validateBody(managementReserveSchema),
  asyncHandler(async (req, res) => {
    const baseline = await svc.setManagementReserve(
      req.params.projectId,
      req.body.managementReserve,
      req.user!.id,
    );
    res.json({ baseline });
  }),
);

export default router;
