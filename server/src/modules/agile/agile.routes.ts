import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { sprintSchema, sprintUpdateSchema, backlogItemSchema, backlogItemUpdateSchema } from './agile.schemas.js';
import * as svc from './agile.service.js';

const router = Router({ mergeParams: true });

const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
const canWrite = [requireProjectAccess({ write: true }), requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER')];

// Board payload: sprints + backlog items.
router.get('/', canRead, asyncHandler(async (req, res) => {
  res.json(await svc.getAgile(req.params.projectId));
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
