import fs from 'node:fs';
import path from 'node:path';
import type { AttachmentOwner } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound, PayloadTooLarge } from '../../lib/errors.js';
import { tenantStorageLimitBytes } from '../../lib/tenant/quota.js';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Uploaded files are namespaced under uploads/<tenantId>/<storageKey> (defence-in-depth + easy
// per-tenant accounting). Resolve a file's path, falling back to the flat legacy location for
// attachments created before namespacing (no filesystem migration needed).
function resolveStoragePath(tenantId: string | null, storageKey: string): string {
  if (tenantId) {
    const scoped = path.join(UPLOAD_DIR, tenantId, storageKey);
    if (fs.existsSync(scoped)) return scoped;
  }
  return path.join(UPLOAD_DIR, storageKey);
}

// The tenant's current storage usage. The aggregate is tenant-scoped by the Prisma extension under
// enforcement (a single global sum when off / single-tenant).
export async function tenantStorageUsed(): Promise<number> {
  const { _sum } = await prisma.attachment.aggregate({ _sum: { sizeBytes: true } });
  return _sum.sizeBytes ?? 0;
}

export const OWNER_TYPES: AttachmentOwner[] = ['CHARTER', 'RISK', 'PROJECT'];

// Verify the attachment's owner entity belongs to the project (prevents cross-project writes).
async function assertOwner(projectId: string, ownerType: AttachmentOwner, ownerId: string): Promise<void> {
  if (ownerType === 'PROJECT') {
    if (ownerId !== projectId) throw BadRequest('ownerId must equal the projectId for PROJECT attachments');
    return;
  }
  if (ownerType === 'CHARTER') {
    const c = await prisma.projectCharter.findFirst({ where: { id: ownerId, projectId }, select: { id: true } });
    if (!c) throw NotFound('Charter not found in this project');
    return;
  }
  if (ownerType === 'RISK') {
    const r = await prisma.risk.findFirst({ where: { id: ownerId, projectId }, select: { id: true } });
    if (!r) throw NotFound('Risk not found in this project');
    return;
  }
  throw BadRequest('Unsupported ownerType');
}

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  filename: string; // multer-generated safe name (the storage key)
  path: string; // absolute path multer saved to (used to clean up a rejected upload)
}

export async function createAttachment(
  projectId: string,
  ownerType: AttachmentOwner,
  ownerId: string,
  file: UploadedFile,
  actorId: string,
) {
  await assertOwner(projectId, ownerType, ownerId);

  // Enforce the per-tenant storage quota (plan-aware — Phase 6). The file is already on disk (multer
  // streamed it), so on rejection we remove it before failing.
  const quota = await tenantStorageLimitBytes();
  const used = await tenantStorageUsed();
  if (used + file.size > quota) {
    try { fs.unlinkSync(file.path); } catch { /* already gone */ }
    throw PayloadTooLarge(`Storage quota exceeded for this workspace (limit ${Math.round(quota / (1024 * 1024))} MB). Delete some attachments and try again.`);
  }

  const attachment = await prisma.attachment.create({
    data: {
      ownerType,
      ownerId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageKey: file.filename,
      uploadedBy: actorId,
      projectRelId: projectId,
      riskRelId: ownerType === 'RISK' ? ownerId : null,
    },
    select: { id: true, ownerType: true, ownerId: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Attachment', entityId: attachment.id, action: 'CREATE', after: { fileName: file.originalname } });
  return attachment;
}

export async function listAttachments(projectId: string, ownerType?: AttachmentOwner, ownerId?: string) {
  return prisma.attachment.findMany({
    where: {
      projectRelId: projectId,
      ...(ownerType ? { ownerType } : {}),
      ...(ownerId ? { ownerId } : {}),
    },
    select: { id: true, ownerType: true, ownerId: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getAttachmentFile(projectId: string, id: string) {
  const att = await prisma.attachment.findFirst({ where: { id, projectRelId: projectId } });
  if (!att) throw NotFound('Attachment not found');
  const absPath = resolveStoragePath(att.tenantId, att.storageKey);
  if (!fs.existsSync(absPath)) throw NotFound('File missing on storage');
  return { att, absPath };
}

export async function deleteAttachment(projectId: string, id: string, actorId: string) {
  const att = await prisma.attachment.findFirst({ where: { id, projectRelId: projectId } });
  if (!att) throw NotFound('Attachment not found');
  // Remove the file then the row (best-effort on the file).
  try {
    fs.unlinkSync(resolveStoragePath(att.tenantId, att.storageKey));
  } catch {
    /* file already gone — proceed */
  }
  await prisma.attachment.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'Attachment', entityId: id, action: 'DELETE', before: { fileName: att.fileName } });
}
