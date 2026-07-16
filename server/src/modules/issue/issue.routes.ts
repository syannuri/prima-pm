import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertIssueSchema } from './issue.schemas.js';
import * as svc from './issue.service.js';

const router = Router({ mergeParams: true });

// Issues are cross-functional; RISK_OFFICER/FINANCE may read alongside the owning PM.
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [
  requireProjectAccess({ write: true }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER'),
];

router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const issues = await svc.listIssues(req.params.projectId);
    res.json({ issues });
  }),
);

router.post(
  '/',
  ...canWrite,
  validateBody(upsertIssueSchema),
  asyncHandler(async (req, res) => {
    const issue = await svc.createIssue(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ issue });
  }),
);

router.put(
  '/:issueId',
  ...canWrite,
  validateBody(upsertIssueSchema),
  asyncHandler(async (req, res) => {
    const issue = await svc.updateIssue(req.params.projectId, req.params.issueId, req.body, req.user!.id);
    res.json({ issue });
  }),
);

router.delete(
  '/:issueId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteIssue(req.params.projectId, req.params.issueId, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
