import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { generateApiKey } from '../../lib/apiKey.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';

// API-key management for the ACTIVE tenant. All reads/writes go through the tenant-scope extension
// (ApiKey is in SCOPED_MODELS), so a tenant only ever sees/edits its own keys. The plaintext secret
// is returned ONCE by createApiKey and never persisted (only its hash).

// Never selects hashedKey — it's write-only from the app's perspective.
const publicSelect = {
  id: true, name: true, prefix: true, role: true,
  lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true,
} as const;

export async function listApiKeys() {
  return prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' }, select: publicSelect });
}

export async function createApiKey(input: { name: string; role: Role; expiresAt?: Date | null }, actorId: string) {
  const gen = generateApiKey();
  const row = await prisma.apiKey.create({
    data: { name: input.name, role: input.role, prefix: gen.prefix, hashedKey: gen.hashedKey, expiresAt: input.expiresAt ?? null, createdById: actorId },
    select: publicSelect,
  });
  await writeAudit({ userId: actorId, entity: 'ApiKey', entityId: row.id, action: 'CREATE', after: { name: row.name, role: row.role } });
  // The plaintext key is shown to the caller this one time only.
  return { ...row, key: gen.plaintext };
}

export async function revokeApiKey(id: string, actorId: string) {
  // findUnique is tenant-scoped by the extension → a key from another tenant reads as not-found.
  const existing = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, revokedAt: true } });
  if (!existing) throw NotFound('API key not found');
  if (existing.revokedAt) return existing; // idempotent
  const row = await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() }, select: { id: true, revokedAt: true } });
  await writeAudit({ userId: actorId, entity: 'ApiKey', entityId: id, action: 'UPDATE', after: { revoked: true } });
  return row;
}
