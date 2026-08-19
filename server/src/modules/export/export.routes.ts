import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { gatherProjectExport } from './export.data.js';
import { buildProjectWorkbook } from './build.excel.js';
import { buildProjectPdf } from './build.pdf.js';
import { gatherGanttExport } from './export.gantt.data.js';
import { buildGanttPdf } from './build.gantt.pdf.js';
import { buildGanttWorkbook } from './build.gantt.excel.js';

const router = Router({ mergeParams: true });

const querySchema = z.object({
  actualCost: z.coerce.number().nonnegative().optional(),
  statusDate: z.coerce.date().optional(),
});

const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });

function safeName(code: string, ext: string, suffix = 'report'): string {
  return `${code.replace(/[^a-zA-Z0-9-_]/g, '_')}_${suffix}.${ext}`;
}

router.get(
  '/excel',
  canRead,
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const data = await gatherProjectExport(req.params.projectId, q);
    const buffer = await buildProjectWorkbook(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(data.project.code, 'xlsx')}"`);
    res.send(buffer);
  }),
);

router.get(
  '/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const data = await gatherProjectExport(req.params.projectId, q);
    const buffer = await buildProjectPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(data.project.code, 'pdf')}"`);
    res.send(buffer);
  }),
);

// Visual Gantt exports — the full schedule charted horizontally (frozen columns + timeline bars).
router.get(
  '/gantt/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const data = await gatherGanttExport(req.params.projectId);
    const buffer = await buildGanttPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(data.project.code, 'pdf', 'gantt')}"`);
    res.send(buffer);
  }),
);

router.get(
  '/gantt/excel',
  canRead,
  asyncHandler(async (req, res) => {
    const data = await gatherGanttExport(req.params.projectId);
    const buffer = await buildGanttWorkbook(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(data.project.code, 'xlsx', 'gantt')}"`);
    res.send(buffer);
  }),
);

export default router;
