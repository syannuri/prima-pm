import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import * as svc from './report.service.js';
import { generateNarrative } from './narrative.service.js';
import { generateEvmExplain } from './evmExplain.service.js';
import { aiEnabled } from '../../lib/ai.js';
import { buildReportPdf } from '../export/build.report.pdf.js';

const router = Router({ mergeParams: true });

// Reporting period + as-of date. period drives the S-curve granularity + the period label.
const reportQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('weekly'),
  asOf: z.coerce.date().optional(),
});

// PM narrative for the reporting bucket — free text, capped so a report stays a summary not an essay.
const commentaryBodySchema = z.object({
  highlights: z.string().max(4000).nullish(),
  lowlights: z.string().max(4000).nullish(),
  nextFocus: z.string().max(4000).nullish(),
});

// Access = the owning PM + ADMIN/PMO (requireProjectAccess default). No FINANCE/RISK: this is
// a PM/PMO status report.
router.get(
  '/',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const { period, asOf } = reportQuerySchema.parse(req.query);
    res.json(await svc.getProjectReport(req.params.projectId, period, asOf ?? new Date()));
  }),
);

// Save (upsert) the PM narrative for a reporting bucket. Write access = PM/PMO/ADMIN.
router.put(
  '/commentary',
  requireProjectAccess({ write: true }),
  asyncHandler(async (req, res) => {
    const { period, asOf } = reportQuerySchema.parse(req.query);
    const body = commentaryBodySchema.parse(req.body);
    const author = { id: req.user!.id, email: req.user!.email };
    res.json(await svc.saveCommentary(req.params.projectId, period, asOf ?? new Date(), body, author));
  }),
);

// AI Status Narrative — generate a DRAFT narrative from the report data. Never persists: the PM
// reviews/edits the returned {executiveSummary,highlights,lowlights,nextFocus} then saves via
// PUT /commentary. Write access = PM/PMO/ADMIN (API keys are read-only ⇒ already 403'd here).
// Gated globally by ANTHROPIC_API_KEY (503 when unset) + per-tenant opt-in (403 in the service).
// The per-tenant request rate limiter already applies (requireAuth), so no extra throttle here.
router.post(
  '/commentary/ai-draft',
  requireProjectAccess({ write: true }),
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    const { period, asOf } = reportQuerySchema.parse(req.query);
    // Draft follows the caller's UI language (client sends ?lang=); Indonesian is the default.
    const lang = req.query.lang === 'en' ? 'en' : 'id';
    res.json(await generateNarrative(req.params.projectId, period, asOf ?? new Date(), lang));
  }),
);

// AI EVM explainer — interprets the current EVM/forecast picture and proposes recovery actions.
// Advisory, ephemeral (never persists). Read access is enough (any project member). Gated globally
// by ANTHROPIC_API_KEY (503) + per-tenant opt-in (403 in the service).
router.post(
  '/evm-explain/ai-draft',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    const { asOf } = reportQuerySchema.parse(req.query);
    res.json(await generateEvmExplain(req.params.projectId, asOf ?? new Date()));
  }),
);

// The same report as a professional PDF (period-aware).
router.get(
  '/pdf',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const { period, asOf } = reportQuerySchema.parse(req.query);
    const report = await svc.getProjectReport(req.params.projectId, period, asOf ?? new Date());
    const buffer = await buildReportPdf(report);
    res.setHeader('Content-Type', 'application/pdf');
    const safeCode = report.project.code.replace(/[^A-Za-z0-9._-]/g, '') || 'project'; // no header/filename injection
    res.setHeader('Content-Disposition', `attachment; filename="${safeCode}_${period}_status_report.pdf"`);
    res.send(buffer);
  }),
);

export default router;
