import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { BadRequest } from '../../lib/errors.js';
import {
  directLineSchema,
  reorderDirectSchema,
  indirectLineSchema,
  managementReserveSchema,
  actualCostSchema,
  autoPostLabourSchema,
} from './cost.schemas.js';
import * as svc from './cost.service.js';
import {
  parseDirectUpload, commitDirectImport,
  parseIndirectUpload, commitIndirectImport,
} from './cost-import.service.js';

const router = Router({ mergeParams: true });

// In-memory upload (parsed, never stored); 5 MB cap; xlsx or csv only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|csv)$/i.test(file.originalname) || /spreadsheetml|excel|csv|octet-stream/i.test(file.mimetype);
    if (!ok) { cb(BadRequest('Only .xlsx or .csv files are accepted')); return; }
    cb(null, true);
  },
});

// Writers for cost: PM (owner), PMO, ADMIN, FINANCE (functional, cross-project).
const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
const canWrite = [
  requireProjectAccess({ write: true, allowRoles: ['FINANCE'] }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE'),
];

// Summary: direct + indirect lines, baseline roll-up, charter variance source.
router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const summary = await svc.getCostSummary(req.params.projectId);
    res.json(summary);
  }),
);

// Recompute baseline on demand (e.g. after risks change).
router.post(
  '/recompute',
  ...canWrite,
  asyncHandler(async (req, res) => {
    const baseline = await svc.recomputeBaseline(req.params.projectId);
    res.json({ baseline });
  }),
);

// --- Direct cost lines ---
router.post(
  '/direct',
  ...canWrite,
  validateBody(directLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.addDirectLine(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ line });
  }),
);

// Spreadsheet import of budget lines. ?dryRun=true (default) previews without writing; without it,
// commit — but only if every row is valid (all-or-nothing). Direct + indirect share the pattern.
router.post('/import/direct', ...canWrite, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw BadRequest('file is required (field "file")');
  const preview = await parseDirectUpload(req.file.buffer, req.file.originalname);
  if (req.query.dryRun !== 'false') {
    res.json({ dryRun: true, total: preview.total, willImport: preview.rows.length, errors: preview.errors });
    return;
  }
  if (preview.errors.length > 0) throw BadRequest(`Import has ${preview.errors.length} invalid row(s); fix them or re-run as a dry run to review.`);
  res.status(201).json({ dryRun: false, ...(await commitDirectImport(req.params.projectId, preview.rows, req.user!.id)) });
}));

router.post('/import/indirect', ...canWrite, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw BadRequest('file is required (field "file")');
  const preview = await parseIndirectUpload(req.file.buffer, req.file.originalname);
  if (req.query.dryRun !== 'false') {
    res.json({ dryRun: true, total: preview.total, willImport: preview.rows.length, errors: preview.errors });
    return;
  }
  if (preview.errors.length > 0) throw BadRequest(`Import has ${preview.errors.length} invalid row(s); fix them or re-run as a dry run to review.`);
  res.status(201).json({ dryRun: false, ...(await commitIndirectImport(req.params.projectId, preview.rows, req.user!.id)) });
}));

// Drag-to-reorder direct lines (presentational — allowed even when the baseline is locked).
router.patch(
  '/direct/reorder',
  ...canWrite,
  validateBody(reorderDirectSchema),
  asyncHandler(async (req, res) => {
    await svc.reorderDirectLines(req.params.projectId, req.body.ids, req.user!.id);
    res.status(204).send();
  }),
);

router.put(
  '/direct/:itemId',
  ...canWrite,
  validateBody(directLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.updateDirectLine(req.params.projectId, req.params.itemId, req.body, req.user!.id);
    res.json({ line });
  }),
);

router.delete(
  '/direct/:itemId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteDirectLine(req.params.projectId, req.params.itemId, req.user!.id);
    res.status(204).send();
  }),
);

// --- Indirect cost lines ---
router.post(
  '/indirect',
  ...canWrite,
  validateBody(indirectLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.addIndirectLine(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ line });
  }),
);

router.put(
  '/indirect/:itemId',
  ...canWrite,
  validateBody(indirectLineSchema),
  asyncHandler(async (req, res) => {
    const line = await svc.updateIndirectLine(req.params.projectId, req.params.itemId, req.body, req.user!.id);
    res.json({ line });
  }),
);

router.delete(
  '/indirect/:itemId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteIndirectLine(req.params.projectId, req.params.itemId, req.user!.id);
    res.status(204).send();
  }),
);

// --- Actual Cost entries (time-phased, feeds EVM CPI) ---
router.get(
  '/actuals',
  canRead,
  asyncHandler(async (req, res) => {
    const actuals = await svc.listActualCosts(req.params.projectId);
    res.json({ actuals });
  }),
);

router.post(
  '/actuals',
  ...canWrite,
  validateBody(actualCostSchema),
  asyncHandler(async (req, res) => {
    const entry = await svc.addActualCost(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ entry });
  }),
);

// One-click: fill Actual Cost from logged timesheets (Σ md × day-rate). Idempotent —
// replaces its own prior auto entry; manual AC entries are untouched.
router.post(
  '/actuals/fill-from-timesheet',
  ...canWrite,
  asyncHandler(async (req, res) => {
    const result = await svc.fillActualCostFromTimesheet(req.params.projectId, req.user!.id);
    res.status(201).json(result);
  }),
);

// Toggle auto-posting of labour AC: when on, each man-day mutation re-syncs the labour AC
// entry. Turning it on syncs immediately.
router.patch(
  '/auto-post-labour',
  ...canWrite,
  validateBody(autoPostLabourSchema),
  asyncHandler(async (req, res) => {
    const result = await svc.setAutoPostLabourAc(req.params.projectId, req.body.enabled, req.user!.id);
    res.json(result);
  }),
);

router.delete(
  '/actuals/:entryId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteActualCost(req.params.projectId, req.params.entryId, req.user!.id);
    res.status(204).send();
  }),
);

// --- Management reserve ---
router.patch(
  '/management-reserve',
  ...canWrite,
  validateBody(managementReserveSchema),
  asyncHandler(async (req, res) => {
    const baseline = await svc.setManagementReserve(
      req.params.projectId,
      req.body.managementReserve,
      req.user!.id,
    );
    res.json({ baseline });
  }),
);

export default router;
