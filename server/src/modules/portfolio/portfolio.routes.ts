import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { getPortfolioSummary } from './portfolio.service.js';
import { getPortfolioEvmTrend, captureAllSnapshots } from '../evm/evm.portfolio.js';
import { getAwaitingActivation, getPlanningReminders } from '../projects/activation.js';
import { gatherPortfolioExport } from '../export/export.portfolio.data.js';
import { buildPortfolioPdf } from '../export/build.portfolio.pdf.js';
import { buildPortfolioWorkbook } from '../export/build.portfolio.excel.js';

const router = Router();
router.use(requireAuth);

const querySchema = z.object({ statusDate: z.coerce.date().optional() });
const captureAllSchema = z.object({ statusDate: z.coerce.date().optional() });

// Cross-project portfolio EVM summary, scoped to the caller's visible projects.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const summary = await getPortfolioSummary(req.user!.id, req.user!.role, statusDate ?? new Date());
    res.json(summary);
  }),
);

// PMO governance queue: chartered projects that are baseline-ready to activate.
router.get(
  '/awaiting-activation',
  asyncHandler(async (req, res) => {
    res.json(await getAwaitingActivation(req.user!.role));
  }),
);

// "Set Baseline" reminder: still-in-planning projects with an outstanding planning
// artifact (charter / cost baseline / schedule baseline). Role-scoped inside the service.
router.get(
  '/planning-reminders',
  asyncHandler(async (req, res) => {
    res.json(await getPlanningReminders(req.user!.id, req.user!.role));
  }),
);

// Portfolio-wide EVM trend, rolled up from captured per-project snapshots (scoped).
router.get(
  '/evm/trend',
  asyncHandler(async (req, res) => {
    res.json(await getPortfolioEvmTrend(req.user!.id, req.user!.role));
  }),
);

// Capture a snapshot for every visible non-DRAFT project at once (ADMIN/PMO across
// the portfolio; a PM captures only their own projects).
router.post(
  '/evm/capture-all',
  requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER'),
  validateBody(captureAllSchema),
  asyncHandler(async (req, res) => {
    const result = await captureAllSnapshots(req.user!.id, req.user!.role, req.body.statusDate);
    res.status(201).json(result);
  }),
);

// Portfolio-wide report exports (summary + rolled-up EVM trend), role-scoped.
router.get(
  '/export/excel',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const data = await gatherPortfolioExport(req.user!.id, req.user!.role, statusDate ?? new Date());
    const buffer = await buildPortfolioWorkbook(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="portfolio_report.xlsx"');
    res.send(buffer);
  }),
);

router.get(
  '/export/pdf',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const data = await gatherPortfolioExport(req.user!.id, req.user!.role, statusDate ?? new Date());
    const buffer = await buildPortfolioPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="portfolio_report.pdf"');
    res.send(buffer);
  }),
);

export default router;
