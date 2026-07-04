import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { mandayEntrySchema } from './timesheet.schemas.js';
import * as svc from './timesheet.service.js';

// Self-service "My Timesheet" — any authenticated user, scoped to the manpower
// lines assigned to them. No project access required; enforced per-line in the
// service. Mounted at /api/v1/me/timesheet.
const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await svc.getMyTimesheet(req.user!.id));
  }),
);

router.post(
  '/',
  validateBody(mandayEntrySchema),
  asyncHandler(async (req, res) => {
    const entry = await svc.addMyMandayEntry(req.user!.id, req.body);
    res.status(201).json({ entry });
  }),
);

router.delete(
  '/:entryId',
  asyncHandler(async (req, res) => {
    await svc.deleteMyMandayEntry(req.user!.id, req.params.entryId);
    res.status(204).send();
  }),
);

export default router;
