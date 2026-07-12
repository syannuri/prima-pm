import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertRequirementSchema, linkTaskSchema } from './requirement.schemas.js';
import * as svc from './requirement.service.js';

const router = Router({ mergeParams: true });

// The requirements register is cross-functional; FINANCE/RISK_OFFICER may read it too.
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [requireProjectAccess({ write: true }), requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER')];

router.get('/', canRead, asyncHandler(async (req, res) => {
  res.json(await svc.listRequirements(req.params.projectId));
}));

router.post('/', ...canWrite, validateBody(upsertRequirementSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ requirement: await svc.createRequirement(req.params.projectId, req.body, req.user!.id) });
}));

router.put('/:requirementId', ...canWrite, validateBody(upsertRequirementSchema), asyncHandler(async (req, res) => {
  res.json({ requirement: await svc.updateRequirement(req.params.projectId, req.params.requirementId, req.body, req.user!.id) });
}));

router.delete('/:requirementId', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteRequirement(req.params.projectId, req.params.requirementId, req.user!.id);
  res.status(204).send();
}));

// Traceability links to WBS tasks.
router.post('/:requirementId/links', ...canWrite, validateBody(linkTaskSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ link: await svc.linkTask(req.params.projectId, req.params.requirementId, req.body.taskId, req.user!.id) });
}));

router.delete('/:requirementId/links/:taskId', ...canWrite, asyncHandler(async (req, res) => {
  await svc.unlinkTask(req.params.projectId, req.params.requirementId, req.params.taskId, req.user!.id);
  res.status(204).send();
}));

export default router;
