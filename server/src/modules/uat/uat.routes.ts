import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { createTestCaseSchema, updateTestCaseSchema } from './uat.schemas.js';
import * as svc from './uat.service.js';

const router = Router({ mergeParams: true });

// UAT is a delivery artifact: the owning PM + ADMIN/PMO manage it (same as Closeout). Read is
// the default project access (owner + ADMIN/PMO); write also requires one of those roles.
const canRead = requireProjectAccess();
const canWrite = [requireProjectAccess({ write: true }), requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER')];

router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await svc.listTestCases(req.params.projectId));
  }),
);

router.post(
  '/',
  ...canWrite,
  validateBody(createTestCaseSchema),
  asyncHandler(async (req, res) => {
    const testCase = await svc.createTestCase(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ testCase });
  }),
);

router.patch(
  '/:id',
  ...canWrite,
  validateBody(updateTestCaseSchema),
  asyncHandler(async (req, res) => {
    const testCase = await svc.updateTestCase(req.params.projectId, req.params.id, req.body, req.user!.id);
    res.json({ testCase });
  }),
);

router.delete(
  '/:id',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteTestCase(req.params.projectId, req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
