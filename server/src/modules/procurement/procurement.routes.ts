import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertProcurementSchema } from './procurement.schemas.js';
import * as svc from './procurement.service.js';

const router = Router({ mergeParams: true });

// Procurement is financial → FINANCE reads it alongside the owning PM (like cost).
const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
const canWrite = [requireProjectAccess({ write: true }), requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER')];

router.get('/', canRead, asyncHandler(async (req, res) => {
  res.json({ procurements: await svc.listProcurements(req.params.projectId) });
}));

router.post('/', ...canWrite, validateBody(upsertProcurementSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ procurement: await svc.createProcurement(req.params.projectId, req.body, req.user!.id) });
}));

router.put('/:procurementId', ...canWrite, validateBody(upsertProcurementSchema), asyncHandler(async (req, res) => {
  res.json({ procurement: await svc.updateProcurement(req.params.projectId, req.params.procurementId, req.body, req.user!.id) });
}));

router.delete('/:procurementId', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteProcurement(req.params.projectId, req.params.procurementId, req.user!.id);
  res.status(204).send();
}));

export default router;
