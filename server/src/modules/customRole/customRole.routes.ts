import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import * as svc from './customRole.service.js';

// Org-defined role catalog. Any signed-in member may read it (needed to render role labels); only an ADMIN
// manages it. Mounted at /custom-roles.
const router = Router();
router.use(requireAuth);

const baseRoleEnum = z.enum(['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER']);
const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  baseRole: baseRoleEnum,
  description: z.string().trim().max(280).optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  baseRole: baseRoleEnum.optional(),
  description: z.string().trim().max(280).nullable().optional(),
});

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ roles: await svc.listRoles(), baseRoles: svc.BASE_ROLES });
}));

router.post('/', requireRole('ADMIN'), validateBody(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ role: await svc.createRole(req.body) });
}));

router.put('/:id', requireRole('ADMIN'), validateBody(updateSchema), asyncHandler(async (req, res) => {
  res.json({ role: await svc.updateRole(req.params.id, req.body) });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  await svc.deleteRole(req.params.id);
  res.status(204).send();
}));

export default router;
