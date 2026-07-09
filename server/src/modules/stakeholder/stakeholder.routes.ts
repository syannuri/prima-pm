import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertStakeholderSchema } from './stakeholder.schemas.js';
import * as svc from './stakeholder.service.js';

const router = Router({ mergeParams: true });

// The stakeholder register is cross-functional; FINANCE/RISK_OFFICER may read it too.
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [requireProjectAccess({ write: true }), requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER')];

router.get('/', canRead, asyncHandler(async (req, res) => {
  res.json({ stakeholders: await svc.listStakeholders(req.params.projectId) });
}));

router.post('/', ...canWrite, validateBody(upsertStakeholderSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ stakeholder: await svc.createStakeholder(req.params.projectId, req.body, req.user!.id) });
}));

router.put('/:stakeholderId', ...canWrite, validateBody(upsertStakeholderSchema), asyncHandler(async (req, res) => {
  res.json({ stakeholder: await svc.updateStakeholder(req.params.projectId, req.params.stakeholderId, req.body, req.user!.id) });
}));

router.delete('/:stakeholderId', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteStakeholder(req.params.projectId, req.params.stakeholderId, req.user!.id);
  res.status(204).send();
}));

export default router;
