import type { Procurement } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { UpsertProcurementInput } from './procurement.schemas.js';

// PRC-001, PRC-002, …
export function generateProcurementCode(seq: number): string {
  return `PRC-${String(seq).padStart(3, '0')}`;
}

// Serialize the Decimal amount to a number for the client (mirrors the cost/portfolio pattern).
function out(p: Procurement) {
  return { ...p, amount: p.amount == null ? null : Number(p.amount) };
}

function buildData(input: UpsertProcurementInput) {
  return {
    title: input.title,
    vendor: input.vendor ?? null,
    vendorContact: input.vendorContact ?? null,
    type: input.type,
    status: input.status,
    amount: input.amount ?? null,
    needBy: input.needBy ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    scope: input.scope ?? null,
    notes: input.notes ?? null,
  };
}

export async function listProcurements(projectId: string) {
  const rows = await prisma.procurement.findMany({ where: { projectId }, orderBy: { code: 'asc' } });
  return rows.map(out);
}

export async function createProcurement(projectId: string, input: UpsertProcurementInput, actorId: string) {
  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.procurement.count({ where: { projectId } });
    return tx.procurement.create({
      data: { ...buildData(input), projectId, code: generateProcurementCode(count + 1), createdById: actorId },
    });
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Procurement', entityId: created.id, action: 'CREATE', after: created });
  return out(created);
}

export async function updateProcurement(projectId: string, id: string, input: UpsertProcurementInput, actorId: string) {
  const existing = await prisma.procurement.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Procurement not found');
  const updated = await prisma.procurement.update({ where: { id }, data: buildData(input) });
  await writeAudit({ projectId, userId: actorId, entity: 'Procurement', entityId: id, action: 'UPDATE', before: existing, after: updated });
  return out(updated);
}

export async function deleteProcurement(projectId: string, id: string, actorId: string) {
  const existing = await prisma.procurement.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Procurement not found');
  await prisma.procurement.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'Procurement', entityId: id, action: 'DELETE', before: existing });
}
