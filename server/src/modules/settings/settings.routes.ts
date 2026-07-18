import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { getAppSettings, updateAppSettings, isGoogleConfigured } from './settings.service.js';

// ADMIN-only runtime settings: toggle the open sign-up paths without an env change + restart.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const patchSchema = z
  .object({
    guestSignupEnabled: z.boolean().optional(),
    googleLoginEnabled: z.boolean().optional(),
  })
  .refine((d) => d.guestSignupEnabled !== undefined || d.googleLoginEnabled !== undefined, 'Nothing to update');

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const s = await getAppSettings();
    // googleConfigured tells the UI whether the Google toggle can be turned on (needs a client ID).
    res.json({ ...s, googleConfigured: isGoogleConfigured() });
  }),
);

router.patch(
  '/',
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const s = await updateAppSettings(req.body, req.user!.id);
    res.json({ ...s, googleConfigured: isGoogleConfigured() });
  }),
);

export default router;
