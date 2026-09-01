import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertTaskSchema, dependencySchema, dependencyEditSchema, evmQuerySchema, progressSchema, taskActualsSchema, taskStepsSchema, applyTemplateSchema } from './schedule.schemas.js';
import * as svc from './schedule.service.js';
import { notifyActivationReady } from '../projects/activation.js';
import { aiEnabled } from '../../lib/ai.js';
import { ApplyScheduleDraftSchema, generateScheduleDraft, applyScheduleDraft } from './scheduleSuggest.service.js';

const router = Router({ mergeParams: true });

const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
// TEAM_MEMBER (PIC) may update task progress/actuals; write guard refined per route.
const canWrite = [
  requireProjectAccess({ write: true }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER'),
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

// AI-generated timeline from the Project Charter (advisory, ephemeral — persists nothing). Gated
// globally by ANTHROPIC_API_KEY (503) + per-tenant opt-in (403 in the service). The PM reviews the
// draft and applies it via /apply-ai-draft.
router.post('/ai-generate', ...canWrite, asyncHandler(async (req, res) => {
  if (!aiEnabled()) {
    res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
    return;
  }
  // Generate schedule text in the PM's current app language (defaults to English).
  const lang = req.body?.lang === 'id' ? 'id' : 'en';
  res.json(await generateScheduleDraft(req.params.projectId, lang));
}));

// Apply a (possibly PM-edited) AI schedule draft into the WBS. Same write authorization as tasks.
router.post('/apply-ai-draft', ...canWrite, validateBody(ApplyScheduleDraftSchema), asyncHandler(async (req, res) => {
  const { startDate, ...draft } = req.body;
  const result = await applyScheduleDraft(req.params.projectId, draft, startDate, req.user!.id);
  res.status(201).json(result);
}));

router.post('/tasks', ...canWrite, validateBody(upsertTaskSchema), asyncHandler(async (req, res) => {
  const task = await svc.createTask(req.params.projectId, req.body, req.user!.id);
  res.status(201).json({ task });
}));

router.put('/tasks/:taskId', ...canWrite, validateBody(upsertTaskSchema), asyncHandler(async (req, res) => {
  const task = await svc.updateTask(req.params.projectId, req.params.taskId, req.body, req.user!.id);
  // Moving a task's dates may violate a dependency downstream — push successors (see applyAutoSchedule).
  const auto = await svc.applyAutoSchedule(req.params.projectId, { actorId: req.user!.id });
  res.json({ task, autoScheduled: auto.moved });
}));

// Recompute the whole schedule against its dependency network. ?dryRun=1 previews
// the moves without persisting (used by the "Rapikan jadwal" confirm dialog).
router.post('/reschedule', ...canWrite, asyncHandler(async (req, res) => {
  const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
  const mode = (req.query.mode === 'asap' || req.body?.mode === 'asap') ? 'asap' : 'push';
  const out = await svc.applyAutoSchedule(req.params.projectId, { dryRun, mode, actorId: req.user!.id });
  res.json(out);
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

// Weighted progress steps (P6-style): the task's % is derived from the done steps' weights.
router.get('/tasks/:taskId/steps', canRead, asyncHandler(async (req, res) => {
  res.json({ steps: await svc.getTaskSteps(req.params.projectId, req.params.taskId) });
}));
router.put('/tasks/:taskId/steps', ...canWrite, validateBody(taskStepsSchema), asyncHandler(async (req, res) => {
  const steps = await svc.setTaskSteps(req.params.projectId, req.params.taskId, req.body, req.user!.id);
  res.json({ steps });
}));

// Actual-date tracking — editable during execution even under a locked baseline (see service).
router.patch('/tasks/:taskId/actuals', ...canWrite, validateBody(taskActualsSchema), asyncHandler(async (req, res) => {
  const task = await svc.setTaskActuals(req.params.projectId, req.params.taskId, req.body, req.user!.id);
  res.json({ task });
}));

router.delete('/tasks/:taskId', ...canWrite, asyncHandler(async (req, res) => {
  const result = await svc.deleteTask(req.params.projectId, req.params.taskId, req.user!.id);
  res.json(result);
}));

// Dependencies (successor task gains a predecessor).
router.post('/tasks/:taskId/dependencies', ...canWrite, validateBody(dependencySchema), asyncHandler(async (req, res) => {
  const dep = await svc.addDependency(req.params.projectId, req.params.taskId, req.body, req.user!.id);
  // A new link can immediately make the successor illegal — settle the schedule now.
  const auto = await svc.applyAutoSchedule(req.params.projectId, { actorId: req.user!.id });
  res.status(201).json({ dependency: dep, autoScheduled: auto.moved });
}));

// Edit a link's type (FS/SS/FF/SF) / lag, then re-settle the schedule.
router.patch('/dependencies/:depId', ...canWrite, validateBody(dependencyEditSchema), asyncHandler(async (req, res) => {
  const dep = await svc.updateDependency(req.params.projectId, req.params.depId, req.body, req.user!.id);
  const auto = await svc.applyAutoSchedule(req.params.projectId, { actorId: req.user!.id });
  res.json({ dependency: dep, autoScheduled: auto.moved });
}));

router.delete('/dependencies/:depId', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteDependency(req.params.projectId, req.params.depId, req.user!.id);
  res.status(204).send();
}));

export default router;
