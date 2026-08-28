import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { getPortfolioSummary } from './portfolio.service.js';
import { getPortfolioAttention, draftAttentionNarrative } from './portfolioAttention.service.js';
import { aiEnabled } from '../../lib/ai.js';
import { getPortfolioRaid } from './portfolio.raid.js';
import { getPortfolioEvmTrend, captureAllSnapshots } from '../evm/evm.portfolio.js';
import { getAwaitingActivation, getPlanningReminders } from '../projects/activation.js';
import { getAwaitingClosure } from '../projects/closure.js';
import { gatherPortfolioExport } from '../export/export.portfolio.data.js';
import { buildPortfolioPdf } from '../export/build.portfolio.pdf.js';
import { buildPortfolioWorkbook } from '../export/build.portfolio.excel.js';
import { gatherBoardPack } from '../export/export.boardpack.data.js';
import { buildBoardPackPdf } from '../export/build.boardpack.pdf.js';

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

// "One thing" attention digest — deterministic ranking of where attention matters most this week
// + whether the AI focus narrative is usable. Scoped to the caller's visible projects.
router.get(
  '/attention',
  asyncHandler(async (req, res) => {
    res.json(await getPortfolioAttention(req.user!.id, req.user!.role));
  }),
);

// AI "focus this week" narrative over the ranked digest. Env-gated (503) + tenant opt-in (403).
router.post(
  '/attention/ai-draft',
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    res.json(await draftAttentionNarrative(req.user!.id, req.user!.role));
  }),
);

// Portfolio RAID roll-up — Risks/Assumptions/Issues/Dependencies across the caller's projects.
router.get(
  '/raid',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    res.json(await getPortfolioRaid(req.user!.id, req.user!.role, statusDate ?? new Date()));
  }),
);

// PMO governance queue: chartered projects that are baseline-ready to activate.
router.get(
  '/awaiting-activation',
  asyncHandler(async (req, res) => {
    res.json(await getAwaitingActivation(req.user!.role));
  }),
);

// PMO governance queue: in-progress projects that have met the closure gate and are
// ready for ADMIN/PMO to close (the mirror of awaiting-activation, closing the delivery loop).
router.get(
  '/awaiting-closure',
  asyncHandler(async (req, res) => {
    res.json(await getAwaitingClosure(req.user!.role));
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

// Steering Committee Board Pack — portfolio health + top risks + open issues + decisions needed,
// in one governance PDF. Same role-scoping as the rest of the portfolio (a PM gets their own).
router.get(
  '/board-pack/pdf',
  asyncHandler(async (req, res) => {
    const { statusDate } = querySchema.parse(req.query);
    const data = await gatherBoardPack(req.user!.id, req.user!.role, statusDate ?? new Date());
    const buffer = await buildBoardPackPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="steering_board_pack.pdf"');
    res.send(buffer);
  }),
);

export default router;
