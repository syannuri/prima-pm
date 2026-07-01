import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import * as svc from './forecast.service.js';

const router = Router({ mergeParams: true });

// Project EVM forecast (EAC scenarios, date forecast, margin, S-curve).
router.get(
  '/',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    const statusDate = req.query.statusDate ? new Date(String(req.query.statusDate)) : new Date();
    res.json(await svc.getProjectForecast(req.params.projectId, statusDate));
  }),
);

export default router;
