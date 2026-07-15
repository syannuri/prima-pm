import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess, requireProjectGovernance } from '../../middleware/rbac.js';
import {
  upsertCharterSchema,
  changeRequestSchema,
  crDecisionSchema,
} from './charter.schemas.js';
import * as svc from './charter.service.js';

// mergeParams lets this nested router read :projectId from the parent route.
const router = Router({ mergeParams: true });

// Read charter (any project member with access).
router.get(
  '/',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const charter = await svc.getCharter(req.params.projectId);
    res.json({ charter });
  }),
);

// Create / update charter (draft) — PM of the project, or PMO/ADMIN.
router.put(
  '/',
  requireProjectAccess({ write: true }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER'),
  validateBody(upsertCharterSchema),
  asyncHandler(async (req, res) => {
    const charter = await svc.upsertCharter(req.params.projectId, req.body, req.user!.id);
    res.json({ charter });
  }),
);

// Commit (lock + snapshot + status -> CHARTERED).
router.post(
  '/commit',
  requireProjectAccess({ write: true }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER'),
  asyncHandler(async (req, res) => {
    const charter = await svc.commitCharter(req.params.projectId, req.user!.id);
    res.json({ charter });
  }),
);

// Version history.
router.get(
  '/versions',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const versions = await svc.listCharterVersions(req.params.projectId);
    res.json({ versions });
  }),
);

// Change Requests.
router.get(
  '/change-requests',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const changeRequests = await svc.listChangeRequests(req.params.projectId);
    res.json({ changeRequests });
  }),
);

router.post(
  '/change-requests',
  requireProjectAccess({ write: true }),
  validateBody(changeRequestSchema),
  asyncHandler(async (req, res) => {
    const cr = await svc.createChangeRequest(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ changeRequest: cr });
  }),
);

// Mark a Change Request as under review — PMO/ADMIN only.
router.patch(
  '/change-requests/:crId/review',
  requireProjectAccess(),
  requireRole('ADMIN', 'PMO'),
  asyncHandler(async (req, res) => {
    const cr = await svc.reviewChangeRequest(req.params.projectId, req.params.crId, req.user!.id);
    res.json({ changeRequest: cr });
  }),
);

// Decide a Change Request — PMO/ADMIN only.
router.patch(
  '/change-requests/:crId',
  requireProjectAccess(),
  requireRole('ADMIN', 'PMO'),
  validateBody(crDecisionSchema),
  asyncHandler(async (req, res) => {
    const out = await svc.decideChangeRequest(
      req.params.projectId,
      req.params.crId,
      req.body.decision,
      req.user!.id,
      req.body.applyToRevenue,
    );
    res.json(out);
  }),
);

export default router;
