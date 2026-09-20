import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { aiEnabled } from '../../lib/ai.js';
import { reviewProject, draftReviewNarrative } from './projectReview.service.js';

const router = Router({ mergeParams: true });

// Reading the audit is a status view — functional roles read alongside the owning PM.
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });

// Deterministic project audit (works with AI off).
router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await reviewProject(req.params.projectId));
  }),
);

// Advisory AI narrative over the audit. Env-gated (503) + tenant opt-in (403 via draftReviewNarrative).
router.post(
  '/narrative',
  canRead,
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    res.json(await draftReviewNarrative(req.params.projectId));
  }),
);

export default router;
