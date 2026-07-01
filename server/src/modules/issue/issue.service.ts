import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { UpsertIssueInput } from './issue.schemas.js';

const OWNER_SELECT = { owner: { select: { id: true, name: true } } } as const;

// ISS-001, ISS-002, …
export function generateIssueCode(seq: number): string {
  return `ISS-${String(seq).padStart(3, '0')}`;
}

// A resolved/closed issue carries a resolvedAt stamp; reopening clears it.
function resolvedStamp(status: string, existing?: Date | null): Date | null {
  const isDone = status === 'RESOLVED' || status === 'CLOSED';
  if (!isDone) return null;
  return existing ?? new Date();
}

function buildIssueData(input: UpsertIssueInput, existingResolvedAt?: Date | null) {
  return {
    title: input.title,
    description: input.description ?? null,
    category: input.category ?? null,
    impact: input.impact,
    status: input.status,
    ownerUserId: input.ownerUserId ?? null,
    resolution: input.resolution ?? null,
    resolvedAt: resolvedStamp(input.status, existingResolvedAt),
    ...(input.raisedAt ? { raisedAt: input.raisedAt } : {}),
  };
}

export async function listIssues(projectId: string) {
  return prisma.issue.findMany({
    where: { projectId },
    include: OWNER_SELECT,
    orderBy: { raisedAt: 'desc' },
  });
}

export async function createIssue(projectId: string, input: UpsertIssueInput, actorId: string) {
  const issue = await prisma.$transaction(async (tx) => {
    const count = await tx.issue.count({ where: { projectId } });
    const code = generateIssueCode(count + 1);
    return tx.issue.create({
      data: { ...buildIssueData(input), projectId, code },
      include: OWNER_SELECT,
    });
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Issue', entityId: issue.id, action: 'CREATE', after: issue });
  return issue;
}

export async function updateIssue(projectId: string, issueId: string, input: UpsertIssueInput, actorId: string) {
  const existing = await prisma.issue.findFirst({ where: { id: issueId, projectId } });
  if (!existing) throw NotFound('Issue not found');

  const issue = await prisma.issue.update({
    where: { id: issueId },
    data: buildIssueData(input, existing.resolvedAt),
    include: OWNER_SELECT,
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Issue', entityId: issueId, action: 'UPDATE', before: existing, after: issue });
  return issue;
}

export async function deleteIssue(projectId: string, issueId: string, actorId: string) {
  const existing = await prisma.issue.findFirst({ where: { id: issueId, projectId } });
  if (!existing) throw NotFound('Issue not found');
  await prisma.issue.delete({ where: { id: issueId } });
  await writeAudit({ projectId, userId: actorId, entity: 'Issue', entityId: issueId, action: 'DELETE', before: existing });
}
