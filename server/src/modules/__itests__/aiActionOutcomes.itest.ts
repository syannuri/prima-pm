import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import {
  recordBaseline, measureDueOutcomes, getActionEffectiveness, listRecentOutcomes, HORIZON_DAYS,
} from '../aiActions/aiActionOutcomes.service.js';

// Outcome learning — closes the Stage C loop. The verdict/aggregation math is unit-tested in
// aiActions/__tests__/aiActionOutcomes.test.ts; this proves the DB wiring end-to-end: baseline on
// apply, the horizon-gated measurement sweep, and tenant-scoped aggregation. Deterministic — no AI
// key needed (the whole feature is heuristic, no LLM).

const DAY_MS = 24 * 60 * 60 * 1000;
let prevFlag: string | undefined;
let tenantA = '', tenantB = '', projA1 = '', projA2 = '', projB1 = '';

// Create a proposal (required unique FK for an outcome) in the CURRENT tenant context.
async function makeProposal(projectId: string, actionType: string) {
  return prisma.aiActionProposal.create({ data: { projectId, actionType, params: {}, status: 'APPLIED', appliedAt: new Date() } });
}

// Seed a fully-measured outcome directly (bypasses the horizon) so aggregation can be asserted.
async function seedMeasured(projectId: string, actionType: string, verdict: string, spiDelta: number | null) {
  const p = await makeProposal(projectId, actionType);
  const before = 0.8, after = spiDelta == null ? null : before + spiDelta;
  await prisma.aiActionOutcome.create({
    data: {
      projectId, proposalId: p.id, actionType, scored: verdict !== 'ADVISORY',
      appliedAt: new Date(Date.now() - 30 * DAY_MS), evalDueAt: new Date(Date.now() - 9 * DAY_MS),
      spiBefore: before, spiAfter: after, spiDelta, measuredAt: new Date(), verdict: verdict as never,
    },
  });
}

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);

  const a = await prisma.tenant.create({ data: { slug: 'outco-a', name: 'Outcome A' } });
  const b = await prisma.tenant.create({ data: { slug: 'outco-b', name: 'Outcome B' } });
  tenantA = a.id; tenantB = b.id;

  const mk = (tid: string, code: string) => runWithTenant(tid, () =>
    prisma.project.create({ data: { code, name: code, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } }).then((p) => p.id));
  projA1 = await mk(tenantA, 'OUT-A1');
  projA2 = await mk(tenantA, 'OUT-A2');
  projB1 = await mk(tenantB, 'OUT-B1');
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('recordBaseline', () => {
  it('scores metric-moving actions (TIDY_SCHEDULE) as PENDING with a horizon-dated eval', async () => {
    const p = await runWithTenant(tenantA, () => makeProposal(projA1, 'TIDY_SCHEDULE'));
    const appliedAt = new Date();
    await runWithTenant(tenantA, () => recordBaseline({ id: p.id, actionType: 'TIDY_SCHEDULE', projectId: projA1 }, appliedAt));

    const o = await runWithTenant(tenantA, () => prisma.aiActionOutcome.findUnique({ where: { proposalId: p.id } }));
    expect(o?.scored).toBe(true);
    expect(o?.verdict).toBe('PENDING');
    expect(o?.tenantId).toBe(tenantA); // stamped by the tenant extension
    expect(Math.round(((o!.evalDueAt.getTime() - appliedAt.getTime()) / DAY_MS))).toBe(HORIZON_DAYS);
  });

  it('records risk/CR actions as ADVISORY (not scored)', async () => {
    const p = await runWithTenant(tenantA, () => makeProposal(projA1, 'CREATE_RISK'));
    await runWithTenant(tenantA, () => recordBaseline({ id: p.id, actionType: 'CREATE_RISK', projectId: projA1 }, new Date()));
    const o = await runWithTenant(tenantA, () => prisma.aiActionOutcome.findUnique({ where: { proposalId: p.id } }));
    expect(o?.scored).toBe(false);
    expect(o?.verdict).toBe('ADVISORY');
  });
});

describe('measureDueOutcomes', () => {
  it('resolves due PENDING outcomes, leaves not-yet-due ones, and is idempotent', async () => {
    // One due (evalDueAt in the past), one not due (far future). No EVM data → INCONCLUSIVE.
    const due = await runWithTenant(tenantA, () => makeProposal(projA2, 'TIDY_SCHEDULE'));
    const future = await runWithTenant(tenantA, () => makeProposal(projA2, 'TIDY_SCHEDULE'));
    await runWithTenant(tenantA, async () => {
      await prisma.aiActionOutcome.create({ data: { projectId: projA2, proposalId: due.id, actionType: 'TIDY_SCHEDULE', scored: true, appliedAt: new Date(Date.now() - 25 * DAY_MS), evalDueAt: new Date(Date.now() - DAY_MS), spiBefore: 0.9, verdict: 'PENDING' } });
      await prisma.aiActionOutcome.create({ data: { projectId: projA2, proposalId: future.id, actionType: 'TIDY_SCHEDULE', scored: true, appliedAt: new Date(), evalDueAt: new Date(Date.now() + 20 * DAY_MS), spiBefore: 0.9, verdict: 'PENDING' } });
    });

    const r1 = await measureDueOutcomes(new Date());
    expect(r1.measured).toBe(1);
    const dueO = await runWithTenant(tenantA, () => prisma.aiActionOutcome.findUnique({ where: { proposalId: due.id } }));
    const futO = await runWithTenant(tenantA, () => prisma.aiActionOutcome.findUnique({ where: { proposalId: future.id } }));
    expect(dueO?.verdict).not.toBe('PENDING');      // resolved (INCONCLUSIVE — no EVM signal)
    expect(dueO?.measuredAt).not.toBeNull();
    expect(futO?.verdict).toBe('PENDING');           // untouched

    const r2 = await measureDueOutcomes(new Date());  // idempotent
    expect(r2.measured).toBe(0);
  });
});

describe('getActionEffectiveness + tenant scope', () => {
  it('aggregates measured outcomes, applies the sample floor, excludes ADVISORY, and is tenant-isolated', async () => {
    // Tenant A, projA1: 3 IMPROVED + 1 WORSENED TIDY_SCHEDULE (meets floor); 2 UPDATE_TASK_PROGRESS
    // (below floor); 1 ADVISORY CREATE_RISK (excluded). Tenant B: a separate improved outcome.
    await runWithTenant(tenantA, async () => {
      for (const v of ['IMPROVED', 'IMPROVED', 'IMPROVED', 'WORSENED']) await seedMeasured(projA1, 'TIDY_SCHEDULE', v, v === 'IMPROVED' ? 0.1 : -0.1);
      for (const v of ['IMPROVED', 'UNCHANGED']) await seedMeasured(projA1, 'UPDATE_TASK_PROGRESS', v, v === 'IMPROVED' ? 0.05 : 0);
      await seedMeasured(projA1, 'CREATE_RISK', 'ADVISORY', null);
    });
    await runWithTenant(tenantB, () => seedMeasured(projB1, 'TIDY_SCHEDULE', 'IMPROVED', 0.2));

    const statsA = await runWithTenant(tenantA, () => getActionEffectiveness());
    const tidy = statsA.find((s) => s.actionType === 'TIDY_SCHEDULE');
    expect(tidy?.measured).toBe(4);
    expect(tidy?.improved).toBe(3);
    expect(tidy?.improvedRate).toBeCloseTo(0.75);
    const prog = statsA.find((s) => s.actionType === 'UPDATE_TASK_PROGRESS');
    expect(prog?.measured).toBe(2);
    expect(prog?.improvedRate).toBeNull(); // below the sample floor
    expect(statsA.find((s) => s.actionType === 'CREATE_RISK')).toBeUndefined(); // ADVISORY excluded

    // Tenant B sees ONLY its own outcome (isolation), not tenant A's 4.
    const statsB = await runWithTenant(tenantB, () => getActionEffectiveness());
    expect(statsB.find((s) => s.actionType === 'TIDY_SCHEDULE')?.measured).toBe(1);

    // projectId filter narrows to one project; listRecentOutcomes returns measured rows for the tenant.
    const onlyA2 = await runWithTenant(tenantA, () => getActionEffectiveness({ projectId: projA2 }));
    expect(onlyA2.find((s) => s.actionType === 'TIDY_SCHEDULE')).toBeUndefined(); // A2 has no measured scored rows
    const recentA = await runWithTenant(tenantA, () => listRecentOutcomes({ take: 50 }));
    expect(recentA.every((o) => o.project.code.startsWith('OUT-A'))).toBe(true);
  });
});
