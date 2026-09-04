import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { summarizeTenantUsage } from '../../lib/aiUsage.js';
import { budgetStatus } from '../../lib/aiBudget.js';

// Per-tenant AI token & cost dashboard (improvement #1). ADMIN-only, and the read is tenant-scoped
// by the Prisma extension, so a workspace only ever sees its own spend. `window` chooses the range:
// `month` = calendar month to date (default), `30d` = trailing 30 days.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const window = req.query.window === '30d' ? '30d' : 'month';
    const now = new Date();
    const since = window === '30d'
      ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const summary = await summarizeTenantUsage(since);
    // Budget line (null unless caps are configured). Reuse the month total for the month window so we
    // don't re-query; for the 30d window compute against the calendar month inside budgetStatus.
    const monthUsed = window === 'month' ? summary.totals.estimatedCostUsd : undefined;
    const budget = await budgetStatus(monthUsed);
    res.json({ window, ...summary, budget });
  }),
);

export const aiUsageRoutes = router;
