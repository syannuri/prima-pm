import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireRole, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertRiskSchema } from './risk.schemas.js';
import * as svc from './risk.service.js';

const router = Router({ mergeParams: true });

// RISK_OFFICER is a functional role allowed across projects for the risk domain.
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [
  requireProjectAccess({ write: true, allowRoles: ['RISK_OFFICER'] }),
  requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER', 'RISK_OFFICER'),
];

// Risk register.
router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const risks = await svc.listRisks(req.params.projectId);
    res.json({ risks });
  }),
);

// Analysis dashboard (heatmap + severity counts + EMV ranking + contingency reserve).
router.get(
  '/analysis',
  canRead,
  asyncHandler(async (req, res) => {
    const analysis = await svc.getRiskAnalysis(req.params.projectId);
    res.json(analysis);
  }),
);

router.post(
  '/',
  ...canWrite,
  validateBody(upsertRiskSchema),
  asyncHandler(async (req, res) => {
    const risk = await svc.createRisk(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ risk });
  }),
);

router.put(
  '/:riskId',
  ...canWrite,
  validateBody(upsertRiskSchema),
  asyncHandler(async (req, res) => {
    const risk = await svc.updateRisk(req.params.projectId, req.params.riskId, req.body, req.user!.id);
    res.json({ risk });
  }),
);

router.delete(
  '/:riskId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteRisk(req.params.projectId, req.params.riskId, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
