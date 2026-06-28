import fs from 'node:fs';
import path from 'node:path';
import type { AttachmentOwner } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
}

export async function createAttachment(
  projectId: string,
  ownerType: AttachmentOwner,
  ownerId: string,
  file: UploadedFile,
  actorId: string,
) {
  await assertOwner(projectId, ownerType, ownerId);

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
  const absPath = path.join(UPLOAD_DIR, att.storageKey);
  if (!fs.existsSync(absPath)) throw NotFound('File missing on storage');
  return { att, absPath };
}

export async function deleteAttachment(projectId: string, id: string, actorId: string) {
  const att = await prisma.attachment.findFirst({ where: { id, projectRelId: projectId } });
  if (!att) throw NotFound('Attachment not found');
  // Remove the file then the row (best-effort on the file).
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, att.storageKey));
  } catch {
    /* file already gone — proceed */
  }
  await prisma.attachment.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'Attachment', entityId: id, action: 'DELETE', before: { fileName: att.fileName } });
}
