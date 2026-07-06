import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { captureSnapshotSchema } from './evm.schemas.js';
import * as svc from './evm.service.js';

const router = Router({ mergeParams: true });

// Reading the EVM trend is a status view: functional roles read alongside the owning
// PM; capturing/deleting a snapshot is a write (owning PM / ADMIN / PMO).
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [requireProjectAccess({ write: true }), requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER')];

// Coerce ?statusDate= like the schedule /evm + forecast routes (bad string → 400, not NaN).
const statusDateQuery = z.object({ statusDate: z.coerce.date().optional() });

router.get(
  '/trend',
  canRead,
  asyncHandler(async (req, res) => {
    const { statusDate } = statusDateQuery.parse(req.query);
    res.json(await svc.getTrend(req.params.projectId, statusDate ?? new Date()));
  }),
);

router.get(
  '/snapshots',
  canRead,
  asyncHandler(async (req, res) => {
    res.json({ snapshots: await svc.listSnapshots(req.params.projectId) });
  }),
);

router.post(
  '/snapshots',
  ...canWrite,
  validateBody(captureSnapshotSchema),
  asyncHandler(async (req, res) => {
    const snapshot = await svc.captureSnapshot(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ snapshot });
  }),
);

router.delete(
  '/snapshots/:snapshotId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteSnapshot(req.params.projectId, req.params.snapshotId, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
