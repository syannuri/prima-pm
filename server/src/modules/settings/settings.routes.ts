import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePlatformAdmin } from '../../middleware/platformAdmin.js';
import { getAppSettings, updateAppSettings, isGoogleConfigured } from './settings.service.js';

// DEPLOYMENT-level runtime settings (global AppSetting singleton): the open sign-up toggles + weekly
// EVM auto-capture. These affect the WHOLE deployment across all tenants, so they are PLATFORM
// (super-admin) settings — not a per-tenant admin concern.
const router = Router();
router.use(requireAuth, requirePlatformAdmin);

const patchSchema = z
  .object({
    guestSignupEnabled: z.boolean().optional(),
    googleLoginEnabled: z.boolean().optional(),
    orgSignupEnabled: z.boolean().optional(),
    evmAutoCaptureEnabled: z.boolean().optional(),
    evmAutoCaptureWeekday: z.number().int().min(0).max(6).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Nothing to update');

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
