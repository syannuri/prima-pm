import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertRiskSchema } from './risk.schemas.js';
import * as svc from './risk.service.js';
import { generateRiskSuggestions } from './riskSuggest.service.js';
import { aiEnabled } from '../../lib/ai.js';

const router = Router({ mergeParams: true });

// RISK_OFFICER is a functional role allowed across projects for the risk domain.
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [
  requireProjectAccess({ write: true, allowRoles: ['RISK_OFFICER'] }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER', 'RISK_OFFICER'),
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

// AI risk suggestions from the charter + WBS (advisory, ephemeral — persists nothing). Same write
// authorization as creating a risk. Gated globally by ANTHROPIC_API_KEY (503) + per-tenant opt-in
// (403 in the service). The PM reviews the checklist and creates the ones they keep via POST /.
router.post(
  '/ai-suggest',
  ...canWrite,
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    res.json(await generateRiskSuggestions(req.params.projectId));
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
