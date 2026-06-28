import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getResourceCapacity } from './resource.service.js';

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  granularity: z.enum(['week', 'month']).optional(),
});

// Cross-project resource capacity / over-allocation, scoped to the caller's visible projects.
router.get(
  '/capacity',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const report = await getResourceCapacity(req.user!.id, req.user!.role, q);
    res.json(report);
  }),
);

export default router;
