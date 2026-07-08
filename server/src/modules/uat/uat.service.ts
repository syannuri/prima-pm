import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { CreateTestCaseInput, UpdateTestCaseInput } from './uat.schemas.js';

// Collision-safe next code (UAT-001, UAT-002, …) = max existing sequence + 1, so it survives
// deletes/gaps.
async function nextCode(projectId: string): Promise<string> {
  const cases = await prisma.uatTestCase.findMany({ where: { projectId }, select: { code: true } });
  const max = cases.reduce((m, c) => Math.max(m, Number(/(\d+)\s*$/.exec(c.code)?.[1] ?? 0)), 0);
  return `UAT-${String(max + 1).padStart(3, '0')}`;
}

// Pass/fail roll-up for the summary strip. Pass rate is over EXECUTED cases (not-run excluded).
function summarize(cases: { status: string }[]) {
  const by = { NOT_RUN: 0, PASS: 0, FAIL: 0, BLOCKED: 0 } as Record<string, number>;
  for (const c of cases) by[c.status] = (by[c.status] ?? 0) + 1;
  const total = cases.length;
  const executed = total - by.NOT_RUN;
  const passRate = executed > 0 ? Math.round((by.PASS / executed) * 100) : 0;
  return { total, executed, passRate, notRun: by.NOT_RUN, pass: by.PASS, fail: by.FAIL, blocked: by.BLOCKED };
}

export async function listTestCases(projectId: string) {
  const cases = await prisma.uatTestCase.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  // Resolve the FK-less createdById to a name in one batched lookup.
  const ids = [...new Set(cases.map((c) => c.createdById).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  const items = cases.map((c) => ({ ...c, createdByName: c.createdById ? nameMap.get(c.createdById) ?? null : null }));
  return { items, summary: summarize(cases) };
}

export async function createTestCase(projectId: string, input: CreateTestCaseInput, actorId: string) {
  const testCase = await prisma.$transaction(async (tx) => {
    const count = await tx.uatTestCase.count({ where: { projectId } });
    const code = await nextCode(projectId);
    return tx.uatTestCase.create({
      data: {
        projectId,
        code,
        sortOrder: count,
        createdById: actorId,
        title: input.title,
        scenario: input.scenario ?? null,
        steps: input.steps ?? null,
        expected: input.expected,
      },
    });
  });
  await writeAudit({ projectId, userId: actorId, entity: 'UatTestCase', entityId: testCase.id, action: 'CREATE', after: testCase });
  return testCase;
}

export async function updateTestCase(projectId: string, id: string, input: UpdateTestCaseInput, actorId: string) {
  const existing = await prisma.uatTestCase.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Test case not found');

  // Recording a result (status leaves NOT_RUN) auto-stamps executedAt when not given & not set.
  const data: Record<string, unknown> = { ...input };
  if (input.status && input.status !== 'NOT_RUN' && input.executedAt === undefined && !existing.executedAt) {
    data.executedAt = new Date();
  }
  // Re-setting to NOT_RUN clears the execution stamp unless explicitly provided.
  if (input.status === 'NOT_RUN' && input.executedAt === undefined) data.executedAt = null;

  const testCase = await prisma.uatTestCase.update({ where: { id }, data });
  await writeAudit({ projectId, userId: actorId, entity: 'UatTestCase', entityId: id, action: 'UPDATE', before: existing, after: testCase });
  return testCase;
}

export async function deleteTestCase(projectId: string, id: string, actorId: string) {
  const existing = await prisma.uatTestCase.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Test case not found');
  await prisma.uatTestCase.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'UatTestCase', entityId: id, action: 'DELETE', before: existing });
}
