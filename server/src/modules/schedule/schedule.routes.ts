import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertTaskSchema, dependencySchema, evmQuerySchema, progressSchema, applyTemplateSchema } from './schedule.schemas.js';
import * as svc from './schedule.service.js';
import { notifyActivationReady } from '../projects/activation.js';

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

// Critical Path Method: per-task early/late dates, total float & the critical path.
router.get('/cpm', canRead, asyncHandler(async (req, res) => {
  res.json(await svc.getCpm(req.params.projectId));
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
// Curated WBS templates (list) + apply one to seed an empty schedule.
router.get('/templates', canRead, asyncHandler(async (_req, res) => {
  res.json({ templates: svc.getWbsTemplates() });
}));

router.post('/apply-template', ...canWrite, validateBody(applyTemplateSchema), asyncHandler(async (req, res) => {
  const result = await svc.applyTemplate(req.params.projectId, req.body.templateId, req.body.startDate ?? new Date(), req.user!.id);
  res.status(201).json(result);
}));

router.post('/tasks', ...canWrite, validateBody(upsertTaskSchema), asyncHandler(async (req, res) => {
  const task = await svc.createTask(req.params.projectId, req.body, req.user!.id);
  res.status(201).json({ task });
}));

router.put('/tasks/:taskId', ...canWrite, validateBody(upsertTaskSchema), asyncHandler(async (req, res) => {
  const task = await svc.updateTask(req.params.projectId, req.params.taskId, req.body, req.user!.id);
  res.json({ task });
}));

// Capture the schedule baseline (snapshot planned dates).
router.post('/baseline', ...canWrite, asyncHandler(async (req, res) => {
  const result = await svc.setScheduleBaseline(req.params.projectId, req.user!.id);
  // Capturing the schedule baseline may complete the set → notify ADMIN/PMO (once).
  await notifyActivationReady(req.params.projectId, req.user!.id);
  res.json(result);
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
