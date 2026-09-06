import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import * as svc from './crossDep.service.js';

// Cross-project schedule dependencies for a project. Mounted nested under /projects/:projectId/cross-deps,
// reusing the project access guards (read for any member of the project, write for editors). The successor
// side is always this project; the predecessor is a task in another project of the same tenant.
const router = Router({ mergeParams: true });

const createSchema = z.object({
  predecessorTaskId: z.string().min(1),
  successorTaskId: z.string().min(1),
  type: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
  lagDays: z.number().int().min(-3650).max(3650).optional(),
});

router.get('/', requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] }), asyncHandler(async (req, res) => {
  res.json(await svc.listForProject(req.params.projectId));
}));

router.post('/', requireProjectAccess({ write: true }), validateBody(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ link: await svc.createLink(req.params.projectId, req.body) });
}));

router.delete('/:id', requireProjectAccess({ write: true }), asyncHandler(async (req, res) => {
  await svc.deleteLink(req.params.projectId, req.params.id);
  res.status(204).send();
}));

export default router;
