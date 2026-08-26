import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { getCashflow } from './cashflow.service.js';

const router = Router({ mergeParams: true });

// Optional status date (defaults to now) + period granularity. Coercion rejects unparseable
// input with a 400 (mirrors /forecast and /evm).
const cashflowQuerySchema = z.object({
  statusDate: z.coerce.date().optional(),
  granularity: z.enum(['week', 'month', 'quarter']).optional(),
});

// Time-phased cash-flow: per-period planned / actual / forecast / committed + cumulative S-curve.
router.get(
  '/',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    const { statusDate, granularity } = cashflowQuerySchema.parse(req.query);
    res.json(await getCashflow(req.params.projectId, granularity ?? 'month', statusDate ?? new Date()));
  }),
);

export default router;
