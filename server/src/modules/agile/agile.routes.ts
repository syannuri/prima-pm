import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { sprintSchema, sprintUpdateSchema, backlogItemSchema, backlogItemUpdateSchema } from './agile.schemas.js';
import { evmQuerySchema } from '../schedule/schedule.schemas.js';
import * as svc from './agile.service.js';

const router = Router({ mergeParams: true });

const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
const canWrite = [requireProjectAccess({ write: true }), requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER')];

// Board payload: sprints + backlog items.
router.get('/', canRead, asyncHandler(async (req, res) => {
  res.json(await svc.getAgile(req.params.projectId));
}));

// EVM metrics by methodology (?actualCost=&statusDate=) — powers the Agile-tab health
// panel (AGILE → points-EVM, HYBRID → blended WBS+points).
router.get('/evm', canRead, asyncHandler(async (req, res) => {
  const q = evmQuerySchema.parse(req.query);
  res.json(await svc.getProjectEvm(req.params.projectId, q.actualCost, q.statusDate ?? new Date()));
}));

// Sprints
router.post('/sprints', canWrite, validateBody(sprintSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createSprint(req.params.projectId, req.body, req.user!.id));
}));
router.patch('/sprints/:sprintId', canWrite, validateBody(sprintUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await svc.updateSprint(req.params.projectId, req.params.sprintId, req.body, req.user!.id));
}));
router.delete('/sprints/:sprintId', canWrite, asyncHandler(async (req, res) => {
  await svc.deleteSprint(req.params.projectId, req.params.sprintId, req.user!.id);
  res.status(204).end();
}));

// Backlog items
router.post('/items', canWrite, validateBody(backlogItemSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createItem(req.params.projectId, req.body, req.user!.id));
}));
router.patch('/items/:itemId', canWrite, validateBody(backlogItemUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await svc.updateItem(req.params.projectId, req.params.itemId, req.body, req.user!.id));
}));
router.delete('/items/:itemId', canWrite, asyncHandler(async (req, res) => {
  await svc.deleteItem(req.params.projectId, req.params.itemId, req.user!.id);
  res.status(204).end();
}));

export default router;
