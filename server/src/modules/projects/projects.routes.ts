import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { createProjectSchema, updateProjectSchema, reassignPmSchema } from './projects.schemas.js';
import * as svc from './projects.service.js';
import charterRoutes from '../charter/charter.routes.js';
import costRoutes from '../cost/cost.routes.js';
import riskRoutes from '../risk/risk.routes.js';
import scheduleRoutes from '../schedule/schedule.routes.js';
import exportRoutes from '../export/export.routes.js';
import attachmentRoutes from '../attachment/attachment.routes.js';
import auditRoutes from '../audit/audit.routes.js';
import projectNotificationRoutes from '../notification/notification.project.routes.js';
import agileRoutes from '../agile/agile.routes.js';

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

router.patch(
  '/:id',
  requireProjectAccess({ write: true }),
  validateBody(updateProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.updateProject(req.params.id, req.body, req.user!.id);
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
router.use('/:projectId/schedule', scheduleRoutes);
router.use('/:projectId/export', exportRoutes);
router.use('/:projectId/attachments', attachmentRoutes);
router.use('/:projectId/audit', auditRoutes);
router.use('/:projectId/notifications', projectNotificationRoutes);
router.use('/:projectId/agile', agileRoutes);

export default router;
