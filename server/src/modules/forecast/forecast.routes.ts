import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import * as svc from './forecast.service.js';
import { WhatIfSpecSchema, simulateScenario, runWhatIfAi } from './whatif.service.js';
import { aiEnabled } from '../../lib/ai.js';

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

// What-if simulation — deterministic, read-only, no DB writes. Structured spec in, before/after out.
router.post(
  '/whatif',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    const spec = WhatIfSpecSchema.parse(req.body);
    res.json(await simulateScenario(req.params.projectId, spec));
  }),
);

// AI what-if: natural-language question → spec → deterministic sim → narrated trade-off.
// Env-gated (503) + tenant opt-in (403 in the service).
const aiWhatIfBody = z.object({ question: z.string().min(3).max(500) });
router.post(
  '/whatif/ai',
  requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] }),
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    const { question } = aiWhatIfBody.parse(req.body);
    res.json(await runWhatIfAi(req.params.projectId, question));
  }),
);

export default router;
