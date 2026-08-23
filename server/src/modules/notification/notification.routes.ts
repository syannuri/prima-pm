import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { dismissAttention, getAttentionItems, getInbox, getNotificationHistory, getPendingApprovals, getPortfolioAlerts, getRecentChanges, markChangesSeen, markInboxSeen, markNotificationRead } from './notification.service.js';

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

// Follow up (dismiss) one live attention item — re-appears only if the alert changes (new signature).
const dismissSchema = z.object({ signature: z.string().min(1).max(128) });
router.post(
  '/attention/dismiss',
  asyncHandler(async (req, res) => {
    const { signature } = dismissSchema.parse(req.body);
    res.json(await dismissAttention(req.user!.id, signature));
  }),
);

// Personal inbox — discrete events for the current user (e.g. project assignment).
router.get(
  '/inbox',
  asyncHandler(async (req, res) => {
    res.json(await getInbox(req.user!.id));
  }),
);
router.post(
  '/inbox/seen',
  asyncHandler(async (req, res) => {
    res.json(await markInboxSeen(req.user!.id));
  }),
);

// Full notification history (read + unread), cursor-paginated, optional ?category= filter — the
// Notification Center page. "Mark all read" reuses POST /inbox/seen; per-item ✓ reuses /inbox/:id/read.
const historyQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  category: z.enum(['all', 'approvals', 'assignments', 'account', 'other']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const q = historyQuery.parse(req.query);
    res.json(await getNotificationHistory(req.user!.id, q));
  }),
);
// Follow up (mark done) ONE inbox notification (✓) — it won't come back.
router.post(
  '/inbox/:id/read',
  asyncHandler(async (req, res) => {
    res.json(await markNotificationRead(req.user!.id, req.params.id));
  }),
);

// Change requests awaiting a decision (PMO/ADMIN only; others get an empty list).
router.get(
  '/pending-approvals',
  asyncHandler(async (req, res) => {
    res.json(await getPendingApprovals(req.user!.role));
  }),
);

export default router;
