import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { createFieldDefSchema, updateFieldDefSchema, setValuesSchema, FIELD_ENTITIES } from './customField.schemas.js';
import * as svc from './customField.service.js';

// Tenant-level custom-field DEFINITIONS. Any signed-in member may read the definitions (they need them to
// render entity forms); only an ADMIN may create/edit/delete them. Mounted at /custom-fields.
const defRouter = Router();
defRouter.use(requireAuth);

const entityQuery = z.enum(FIELD_ENTITIES).default('project');

defRouter.get('/defs', asyncHandler(async (req, res) => {
  const entity = entityQuery.parse(req.query.entity ?? 'project');
  // Admins get archived defs too (to manage them); everyone else sees only active ones.
  const includeArchived = req.user!.role === 'ADMIN' && req.query.includeArchived === 'true';
  res.json({ defs: await svc.listDefs(entity, { includeArchived }) });
}));

defRouter.post('/defs', requireRole('ADMIN'), validateBody(createFieldDefSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ def: await svc.createDef(req.body) });
}));

defRouter.put('/defs/:id', requireRole('ADMIN'), validateBody(updateFieldDefSchema), asyncHandler(async (req, res) => {
  res.json({ def: await svc.updateDef(req.params.id, req.body) });
}));

defRouter.delete('/defs/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  await svc.deleteDef(req.params.id);
  res.status(204).send();
}));

export default defRouter;

// Per-project custom-field VALUES. Mounted nested under /projects/:projectId/custom-fields, so it reuses
// the project access guards (read for any project member, write for editors). entity is fixed to "project"
// and the entityId is the project id.
export const projectValueRouter = Router({ mergeParams: true });

projectValueRouter.get('/', requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] }), asyncHandler(async (req, res) => {
  res.json({ fields: await svc.getValues('project', req.params.projectId) });
}));

projectValueRouter.put('/', requireProjectAccess({ write: true }), validateBody(setValuesSchema), asyncHandler(async (req, res) => {
  res.json({ fields: await svc.setValues('project', req.params.projectId, req.body) });
}));
