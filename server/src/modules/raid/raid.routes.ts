import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertAssumptionSchema, upsertDependencySchema } from './raid.schemas.js';
import * as svc from './raid.service.js';

const router = Router({ mergeParams: true });

const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [requireProjectAccess({ write: true }), requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER')];

// ---------- Assumptions ----------
router.get('/assumptions', canRead, asyncHandler(async (req, res) => {
  res.json({ assumptions: await svc.listAssumptions(req.params.projectId) });
}));
router.post('/assumptions', ...canWrite, validateBody(upsertAssumptionSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ assumption: await svc.createAssumption(req.params.projectId, req.body, req.user!.id) });
}));
router.put('/assumptions/:id', ...canWrite, validateBody(upsertAssumptionSchema), asyncHandler(async (req, res) => {
  res.json({ assumption: await svc.updateAssumption(req.params.projectId, req.params.id, req.body, req.user!.id) });
}));
router.delete('/assumptions/:id', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteAssumption(req.params.projectId, req.params.id, req.user!.id);
  res.status(204).send();
}));

// ---------- Dependencies ----------
router.get('/dependencies', canRead, asyncHandler(async (req, res) => {
  res.json({ dependencies: await svc.listDependencies(req.params.projectId) });
}));
router.post('/dependencies', ...canWrite, validateBody(upsertDependencySchema), asyncHandler(async (req, res) => {
  res.status(201).json({ dependency: await svc.createDependency(req.params.projectId, req.body, req.user!.id) });
}));
router.put('/dependencies/:id', ...canWrite, validateBody(upsertDependencySchema), asyncHandler(async (req, res) => {
  res.json({ dependency: await svc.updateDependency(req.params.projectId, req.params.id, req.body, req.user!.id) });
}));
router.delete('/dependencies/:id', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteDependency(req.params.projectId, req.params.id, req.user!.id);
  res.status(204).send();
}));

export default router;
