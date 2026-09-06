import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { createProgramSchema, updateProgramSchema, assignProjectSchema } from './program.schemas.js';
import * as svc from './program.service.js';

// Program (portfolio hierarchy) management + roll-up. Any member reads; ADMIN/PMO manage.
const router = Router();
router.use(requireAuth);

const canManage = requireRole('ADMIN', 'PMO');
const dateQuery = z.object({ statusDate: z.coerce.date().optional() });

router.get('/', asyncHandler(async (req, res) => {
  const includeArchived = (req.user!.role === 'ADMIN' || req.user!.role === 'PMO') && req.query.includeArchived === 'true';
  res.json({ programs: await svc.listPrograms({ includeArchived }) });
}));

// EVM roll-up per program across the caller's visible member projects.
router.get('/rollup', asyncHandler(async (req, res) => {
  const { statusDate } = dateQuery.parse(req.query);
  res.json({ programs: await svc.getProgramRollups(req.user!.id, req.user!.role, statusDate ?? new Date()) });
}));

router.post('/', canManage, validateBody(createProgramSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ program: await svc.createProgram(req.body) });
}));

router.put('/:id', canManage, validateBody(updateProgramSchema), asyncHandler(async (req, res) => {
  res.json({ program: await svc.updateProgram(req.params.id, req.body) });
}));

router.delete('/:id', canManage, asyncHandler(async (req, res) => {
  await svc.deleteProgram(req.params.id);
  res.status(204).send();
}));

router.post('/:id/projects', canManage, validateBody(assignProjectSchema), asyncHandler(async (req, res) => {
  await svc.assignProject(req.params.id, req.body.projectId);
  res.status(204).send();
}));

router.delete('/:id/projects/:projectId', canManage, asyncHandler(async (req, res) => {
  await svc.unassignProject(req.params.id, req.params.projectId);
  res.status(204).send();
}));

export default router;
