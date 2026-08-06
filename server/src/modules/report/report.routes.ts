import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import * as svc from './report.service.js';
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
