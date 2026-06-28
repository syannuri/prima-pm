import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { gatherProjectExport } from './export.data.js';
import { buildProjectWorkbook } from './build.excel.js';
import { buildProjectPdf } from './build.pdf.js';

const router = Router({ mergeParams: true });

const querySchema = z.object({
  actualCost: z.coerce.number().nonnegative().optional(),
  statusDate: z.coerce.date().optional(),
});

const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });

function safeName(code: string, ext: string): string {
  return `${code.replace(/[^a-zA-Z0-9-_]/g, '_')}_report.${ext}`;
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

export default router;
