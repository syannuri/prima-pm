import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { mandayEntrySchema } from './timesheet.schemas.js';
import * as svc from './timesheet.service.js';

const router = Router({ mergeParams: true });

// Same access model as Cost: read for FINANCE/RISK too; writes for the owning PM,
// PMO, ADMIN and FINANCE (timesheet is actual-effort/cost data).
const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
const canWrite = [
  requireProjectAccess({ write: true, allowRoles: ['FINANCE'] }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE'),
];

router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await svc.getTimesheet(req.params.projectId));
  }),
);

router.post(
  '/',
  ...canWrite,
  validateBody(mandayEntrySchema),
  asyncHandler(async (req, res) => {
    const entry = await svc.addMandayEntry(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ entry });
  }),
);

router.delete(
  '/:entryId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteMandayEntry(req.params.projectId, req.params.entryId, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
