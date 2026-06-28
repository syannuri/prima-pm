import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { getProjectAlerts } from './notification.service.js';

// Per-project alerts. Mounted at /api/v1/projects/:projectId/notifications.
const router = Router({ mergeParams: true });

const querySchema = z.object({ statusDate: z.coerce.date().optional() });

router.get(
  '/',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const result = await getProjectAlerts(req.params.projectId, statusDate ?? new Date());
    res.json(result);
  }),
);

export default router;
