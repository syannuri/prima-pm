import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { createProjectSchema, updateProjectSchema, reassignPmSchema } from './projects.schemas.js';
import { z } from 'zod';
import * as svc from './projects.service.js';
import { setBaselineLock } from './baseline.service.js';
import { getClosureReadiness } from './closure.js';
import { getActivationReadiness } from './activation.js';
import { getNextSteps } from './nextsteps.js';
import charterRoutes from '../charter/charter.routes.js';
import costRoutes from '../cost/cost.routes.js';
import riskRoutes from '../risk/risk.routes.js';
import issueRoutes from '../issue/issue.routes.js';
import forecastRoutes from '../forecast/forecast.routes.js';
import scheduleRoutes from '../schedule/schedule.routes.js';
import exportRoutes from '../export/export.routes.js';
import attachmentRoutes from '../attachment/attachment.routes.js';
import auditRoutes from '../audit/audit.routes.js';
import projectNotificationRoutes from '../notification/notification.project.routes.js';
import agileRoutes from '../agile/agile.routes.js';
import timesheetRoutes from '../timesheet/timesheet.routes.js';
import closeoutRoutes from '../closeout/closeout.routes.js';

const router = Router();
router.use(requireAuth);

// List (scoped by role) & create.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = await svc.listProjects(req.user!.id, req.user!.role);
    res.json({ projects });
  }),
);

// Only PMO (and ADMIN) may create projects and assign them to a PM.
router.post(
  '/',
  requireRole('ADMIN', 'PMO'),
  validateBody(createProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.createProject(req.body, req.user!.id);
    res.status(201).json({ project });
  }),
);

// Single project (access-checked).
router.get(
  '/:id',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const project = await svc.getProject(req.params.id);
    res.json({ project });
  }),
);

// Closure readiness checklist (blockers + advisory warnings) — shown before closing.
router.get(
  '/:id/closure-readiness',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const readiness = await getClosureReadiness(req.params.id);
    res.json({ readiness });
  }),
);

// Activation readiness checklist (baseline blockers + advisory warnings) — shown before
// starting execution (CHARTERED → IN_PROGRESS).
router.get(
  '/:id/activation-readiness',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const readiness = await getActivationReadiness(req.params.id);
    res.json({ readiness });
  }),
);

// Guided next-step cues — an ordered list of recommended actions for the project's
// current lifecycle stage (charter → baseline → activate → track → close).
router.get(
  '/:id/next-steps',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const nextSteps = await getNextSteps(req.params.id);
    res.json({ nextSteps });
  }),
);

// Project-level details (identity, financials, methodology, status) are a
// portfolio/governance decision — ADMIN/PMO only. PMs manage execution via the
// charter (while draft) and Change Requests, not top-level project edits.
router.patch(
  '/:id',
  requireRole('ADMIN', 'PMO'),
  validateBody(updateProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.updateProject(req.params.id, req.body, req.user!.id);
    res.json({ project });
  }),
);

// Lock / unlock the cost & schedule baseline (PMB/BAC freeze) — ADMIN/PMO only.
// Unlocking requires a reason (audited). requireRole only, so it works while the
// baseline is locked (unlike the project-access write guard).
const baselineLockSchema = z.object({ locked: z.boolean(), reason: z.string().trim().max(500).optional() });
router.patch(
  '/:id/baseline-lock',
  requireRole('ADMIN', 'PMO'),
  validateBody(baselineLockSchema),
  asyncHandler(async (req, res) => {
    const project = await setBaselineLock(req.params.id, req.body.locked, req.body.reason, req.user!.id);
    res.json({ project });
  }),
);

// Reassign the project's PM — ADMIN/PMO only.
router.patch(
  '/:id/pm',
  requireRole('ADMIN', 'PMO'),
  validateBody(reassignPmSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.reassignPm(req.params.id, req.body.pmUserId, req.user!.id);
    res.json({ project });
  }),
);

router.delete(
  '/:id',
  requireRole('ADMIN', 'PMO'),
  requireProjectAccess({ write: true }),
  asyncHandler(async (req, res) => {
    await svc.softDeleteProject(req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

// Nested module routes under a project.
router.use('/:projectId/charter', charterRoutes);
router.use('/:projectId/cost', costRoutes);
router.use('/:projectId/risk', riskRoutes);
router.use('/:projectId/issues', issueRoutes);
router.use('/:projectId/forecast', forecastRoutes);
router.use('/:projectId/schedule', scheduleRoutes);
router.use('/:projectId/export', exportRoutes);
router.use('/:projectId/attachments', attachmentRoutes);
router.use('/:projectId/audit', auditRoutes);
router.use('/:projectId/notifications', projectNotificationRoutes);
router.use('/:projectId/agile', agileRoutes);
router.use('/:projectId/timesheet', timesheetRoutes);
router.use('/:projectId/closeout', closeoutRoutes);

export default router;
