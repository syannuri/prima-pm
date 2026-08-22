import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { TooManyRequests } from '../../lib/errors.js';
import { createFeedbackSchema, type CreateFeedbackBody } from './feedback.schemas.js';
import { createFeedback } from './feedback.service.js';

// In-app product feedback. Mounted at /api/v1/feedback. Any signed-in user (incl. guests) can post.
const router = Router();
router.use(requireAuth);

// Soft anti-spam: at most 5 submits / 10 min per user (in-memory, best-effort — not security).
const WINDOW = 10 * 60_000, MAX = 5;
const recent = new Map<string, number[]>();
function underLimit(userId: string): boolean {
  const now = Date.now();
  const arr = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW);
  if (arr.length >= MAX) { recent.set(userId, arr); return false; }
  arr.push(now); recent.set(userId, arr);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < WINDOW)) recent.delete(k);
  return true;
}

router.post(
  '/',
  validateBody(createFeedbackSchema),
  asyncHandler(async (req, res) => {
    if (!underLimit(req.user!.id)) throw TooManyRequests('Too much feedback at once — please wait a few minutes.');
    const b = req.body as CreateFeedbackBody;
    const out = await createFeedback({
      userId: req.user!.id,
      userEmail: req.user!.email,
      role: req.user!.role,
      type: b.type,
      message: b.message,
      pageUrl: b.pageUrl,
      release: b.release,
      userAgent: req.get('user-agent')?.slice(0, 512),
    });
    res.status(201).json(out);
  }),
);

export default router;
