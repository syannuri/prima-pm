import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { getPortfolioSummary } from './portfolio.service.js';
import { getPortfolioEvmTrend, captureAllSnapshots } from '../evm/evm.portfolio.js';

const router = Router();
router.use(requireAuth);

const querySchema = z.object({ statusDate: z.coerce.date().optional() });
const captureAllSchema = z.object({ statusDate: z.coerce.date().optional() });

// Cross-project portfolio EVM summary, scoped to the caller's visible projects.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const summary = await getPortfolioSummary(req.user!.id, req.user!.role, statusDate ?? new Date());
    res.json(summary);
  }),
);

// Portfolio-wide EVM trend, rolled up from captured per-project snapshots (scoped).
router.get(
  '/evm/trend',
  asyncHandler(async (req, res) => {
    res.json(await getPortfolioEvmTrend(req.user!.id, req.user!.role));
  }),
);

// Capture a snapshot for every visible non-DRAFT project at once (ADMIN/PMO across
// the portfolio; a PM captures only their own projects).
router.post(
  '/evm/capture-all',
  requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER'),
  validateBody(captureAllSchema),
  asyncHandler(async (req, res) => {
    const result = await captureAllSnapshots(req.user!.id, req.user!.role, req.body.statusDate);
    res.status(201).json(result);
  }),
);

export default router;
