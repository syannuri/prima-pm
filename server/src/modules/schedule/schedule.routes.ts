import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertTaskSchema, dependencySchema, evmQuerySchema, progressSchema } from './schedule.schemas.js';
import * as svc from './schedule.service.js';

const router = Router({ mergeParams: true });

const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
// TEAM_MEMBER (PIC) may update task progress/actuals; write guard refined per route.
const canWrite = [
  requireProjectAccess({ write: true }),
  requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER'),
];

// Flat list (tasks + dependencies).
router.get('/', canRead, asyncHandler(async (req, res) => {
  res.json(await svc.listSchedule(req.params.projectId));
}));

// Gantt tree (nested + duration + linked manpower).
router.get('/gantt', canRead, asyncHandler(async (req, res) => {
  res.json(await svc.getGantt(req.params.projectId));
}));

// Manpower <-> schedule reconciliation.
router.get('/manpower-sync', canRead, asyncHandler(async (req, res) => {
  res.json({ rows: await svc.getManpowerSync(req.params.projectId) });
}));

// EVM metrics (?actualCost=&statusDate=).
router.get('/evm', canRead, asyncHandler(async (req, res) => {
  const q = evmQuerySchema.parse(req.query);
  const evm = await svc.getEvm(req.params.projectId, q.actualCost, q.statusDate ?? new Date());
  res.json(evm);
}));

// Tasks.
router.post('/tasks', ...canWrite, validateBody(upsertTaskSchema), asyncHandler(async (req, res) => {
  const task = await svc.createTask(req.params.projectId, req.body, req.user!.id);
  res.status(201).json({ task });
}));

router.put('/tasks/:taskId', ...canWrite, validateBody(upsertTaskSchema), asyncHandler(async (req, res) => {
  const task = await svc.updateTask(req.params.projectId, req.params.taskId, req.body, req.user!.id);
  res.json({ task });
}));

// Progress-only update (WBS % complete / status).
router.patch('/tasks/:taskId/progress', ...canWrite, validateBody(progressSchema), asyncHandler(async (req, res) => {
  const task = await svc.setTaskProgress(req.params.projectId, req.params.taskId, req.body.progressPct, req.user!.id);
  res.json({ task });
}));

router.delete('/tasks/:taskId', ...canWrite, asyncHandler(async (req, res) => {
  const result = await svc.deleteTask(req.params.projectId, req.params.taskId, req.user!.id);
  res.json(result);
}));

// Dependencies (successor task gains a predecessor).
router.post('/tasks/:taskId/dependencies', ...canWrite, validateBody(dependencySchema), asyncHandler(async (req, res) => {
  const dep = await svc.addDependency(req.params.projectId, req.params.taskId, req.body, req.user!.id);
  res.status(201).json({ dependency: dep });
}));

router.delete('/dependencies/:depId', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteDependency(req.params.projectId, req.params.depId, req.user!.id);
  res.status(204).send();
}));

export default router;
