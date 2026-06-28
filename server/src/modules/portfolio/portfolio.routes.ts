import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getPortfolioSummary } from './portfolio.service.js';

const router = Router();
router.use(requireAuth);

const querySchema = z.object({ statusDate: z.coerce.date().optional() });

// Cross-project portfolio EVM summary, scoped to the caller's visible projects.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const summary = await getPortfolioSummary(req.user!.id, req.user!.role, statusDate ?? new Date());
    res.json(summary);
  }),
);

export default router;
