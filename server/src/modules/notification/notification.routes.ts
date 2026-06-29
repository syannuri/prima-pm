import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getAttentionItems, getPortfolioAlerts, getRecentChanges, markChangesSeen } from './notification.service.js';

// Portfolio-wide alerts for the header bell. Mounted at /api/v1/notifications.
const router = Router();
router.use(requireAuth);

const querySchema = z.object({ statusDate: z.coerce.date().optional() });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const summary = await getPortfolioAlerts(req.user!.id, req.user!.role, statusDate ?? new Date());
    res.json(summary);
  }),
);

// Recent WBS/Cost/Risk changes — visible to ADMIN & PMO only (others get []).
router.get(
  '/changes',
  asyncHandler(async (req, res) => {
    res.json(await getRecentChanges(req.user!.id, req.user!.role, 25));
  }),
);

// Mark the change feed as seen (resets the unread badge).
router.post(
  '/changes/seen',
  asyncHandler(async (req, res) => {
    res.json(await markChangesSeen(req.user!.id));
  }),
);

// Actionable items across the caller's visible projects (PM action panel).
router.get(
  '/attention',
  asyncHandler(async (req, res) => {
    res.json(await getAttentionItems(req.user!.id, req.user!.role, new Date()));
  }),
);

export default router;
