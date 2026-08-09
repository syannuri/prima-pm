import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { BadRequest } from '../../lib/errors.js';
import { parseTaskUpload, commitTaskImport } from './import.service.js';

// Spreadsheet import for a project (T4.3). mergeParams so :projectId from the parent mount resolves.
const router = Router({ mergeParams: true });

// In-memory (we only parse it, never store it); 5 MB cap; xlsx or csv only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|csv)$/i.test(file.originalname) ||
      /spreadsheetml|excel|csv|octet-stream/i.test(file.mimetype);
    if (!ok) { cb(BadRequest('Only .xlsx or .csv files are accepted')); return; }
    cb(null, true);
  },
});

// POST /projects/:projectId/import/tasks?dryRun=true
// dryRun (default) → parse + validate + return a preview WITHOUT writing. Without it → commit, but
// only if every row is valid (all-or-nothing). Requires write access to the project.
router.post(
  '/tasks',
  requireAuth,
  requireProjectAccess({ write: true }),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw BadRequest('file is required (field "file")');
    const preview = await parseTaskUpload(req.file.buffer, req.file.originalname);
    const dryRun = req.query.dryRun !== 'false'; // preview unless explicitly committing

    if (dryRun) {
      res.json({ dryRun: true, total: preview.total, willImport: preview.rows.length, errors: preview.errors, rows: preview.rows });
      return;
    }
    if (preview.errors.length > 0) {
      throw BadRequest(`Import has ${preview.errors.length} invalid row(s); fix them or re-run as a dry run to review.`);
    }
    const { created } = await commitTaskImport(req.params.projectId, preview.rows, req.user!.id);
    res.status(201).json({ dryRun: false, created });
  }),
);

export default router;
