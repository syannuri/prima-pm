import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { AttachmentOwner } from '@prisma/client';
import { asyncHandler } from '../../middleware/validate.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { BadRequest } from '../../lib/errors.js';
import {
  UPLOAD_DIR,
  OWNER_TYPES,
  createAttachment,
  listAttachments,
  getAttachmentFile,
  deleteAttachment,
} from './attachment.service.js';

const router = Router({ mergeParams: true });

// Disk storage with server-generated safe names (never trust client filename for the path).
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
});

// Whitelist of allowed document/image types (MIME -> permitted file extensions).
// Blocks executables, scripts, archives, etc. Both the reported MIME type and the
// filename extension must match an entry — a mismatch (e.g. `evil.exe` sent as a PDF
// mimetype) is rejected too. MIME can be spoofed, so this is a guardrail, not proof.
const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
};

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedExts = ALLOWED_UPLOAD_TYPES[file.mimetype];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExts || !allowedExts.includes(ext)) {
    cb(BadRequest('Unsupported file type. Allowed: PDF, XLSX, DOCX, PNG, JPG'));
    return;
  }
  cb(null, true);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB cap

const canRead = requireProjectAccess({ allowRoles: ['FINANCE', 'RISK_OFFICER'] });
const canWrite = requireProjectAccess({ write: true, allowRoles: ['RISK_OFFICER', 'FINANCE'] });

function parseOwnerType(value: unknown): AttachmentOwner {
  if (typeof value !== 'string' || !OWNER_TYPES.includes(value as AttachmentOwner)) {
    throw BadRequest(`ownerType must be one of ${OWNER_TYPES.join(', ')}`);
  }
  return value as AttachmentOwner;
}

// List attachments (optionally filtered by owner).
router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const ownerType = req.query.ownerType ? parseOwnerType(req.query.ownerType) : undefined;
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined;
    const attachments = await listAttachments(req.params.projectId, ownerType, ownerId);
    res.json({ attachments });
  }),
);

// Upload (multipart: file + ownerType + ownerId).
router.post(
  '/',
  canWrite,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw BadRequest('file is required');
    const ownerType = parseOwnerType(req.body.ownerType);
    const ownerId = req.body.ownerId;
    if (typeof ownerId !== 'string' || !ownerId) throw BadRequest('ownerId is required');
    const attachment = await createAttachment(req.params.projectId, ownerType, ownerId, req.file, req.user!.id);
    res.status(201).json({ attachment });
  }),
);

// Download the original file.
router.get(
  '/:id/download',
  canRead,
  asyncHandler(async (req, res) => {
    const { att, absPath } = await getAttachmentFile(req.params.projectId, req.params.id);
    res.download(absPath, att.fileName);
  }),
);

// Delete.
router.delete(
  '/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    await deleteAttachment(req.params.projectId, req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
