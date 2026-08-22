import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { listFeedback, updateFeedbackStatus } from './feedback.service.js';

// Admin feedback inbox — per-tenant triage. Mounted at /api/v1/admin/feedback. ADMIN only.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const listQuery = z.object({ status: z.enum(['ALL', 'OPEN', 'REVIEWED', 'CLOSED']).optional() });
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = listQuery.parse(req.query);
    res.json({ items: await listFeedback(status) });
  }),
);

const statusSchema = z.object({ status: z.enum(['OPEN', 'REVIEWED', 'CLOSED']) });
router.patch(
  '/:id',
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    res.json(await updateFeedbackStatus(req.params.id, (req.body as { status: 'OPEN' | 'REVIEWED' | 'CLOSED' }).status));
  }),
);

export default router;
