import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import * as svc from './forecast.service.js';

const router = Router({ mergeParams: true });

// Validate the optional status date so a bad string can't reach the service as an Invalid
// Date (NaN math). Coercion rejects unparseable input with a 400 (mirrors schedule /evm).
const forecastQuerySchema = z.object({
  statusDate: z.coerce.date().optional(),
});

// Project EVM forecast (EAC scenarios, date forecast, margin, S-curve).
router.get(
  '/',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    const { statusDate } = forecastQuerySchema.parse(req.query);
    res.json(await svc.getProjectForecast(req.params.projectId, statusDate ?? new Date()));
  }),
);

export default router;
