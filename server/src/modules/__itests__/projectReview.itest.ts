import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { reviewProject } from '../review/projectReview.service.js';
import { createRequirement } from '../requirement/requirement.service.js';

// Deterministic project-audit collector (Anett Review). Seeds a project with KNOWN gaps and asserts
// the expected finding codes + severities surface; a clean DRAFT project yields no HIGH findings.
// Runs with MULTITENANCY_ENFORCE=false (global roles), like the other integration suites.

let pmId = '';

beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const pm = await prisma.user.create({ data: { name: 'RV PM', email: 'rv-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  pmId = pm.id;
});

const codes = (fs: { code: string }[]) => new Set(fs.map((f) => f.code));

describe('Anett project review — deterministic collector', () => {
  it('surfaces the expected findings on a project riddled with gaps', async () => {
    const p = await prisma.project.create({ data: { code: 'RV-1', name: 'Gappy', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId } });
    // Charter present but missing the deliverables field → GOV_CHARTER_INCOMPLETE.
    await prisma.projectCharter.create({ data: {
      projectId: p.id, description: 'd', goals: 'g', category: 'CYBERSECURITY_INFRA', hiScope: 's', hiDeliverables: '',
      hiCostIdr: 1000, hiScheduleStart: new Date(), hiScheduleEnd: new Date(), pmUserId: pmId, locked: false,
    } });
    // A MUST requirement with no WBS link → SCOPE_MUST_UNCOVERED.
    await createRequirement(p.id, { title: 'Must have MFA', priority: 'MUST', category: 'REGULATORY', status: 'PROPOSED' } as never, pmId);
    // Three ownerless leaf tasks with no dependencies → SCHED_TASK_NO_OWNER + SCHED_NO_DEPENDENCIES.
    for (const n of ['A', 'B', 'C']) {
      await prisma.task.create({ data: { projectId: p.id, wbsCode: n, name: `Task ${n}`, planStart: new Date('2030-01-01'), planEnd: new Date('2030-01-05'), progressPct: 0 } });
    }
    // An open HIGH risk with neither a response strategy nor an owner → RISK_HIGH_NO_STRATEGY + RISK_HIGH_NO_OWNER.
    await prisma.risk.create({ data: {
      projectId: p.id, code: 'RSK-001', title: 'Vendor breach', status: 'OPEN', severity: 'HIGH',
      probabilityScore: 4, impactScore: 5, riskScore: 20, probabilityPct: 0.8, impactCostIdr: 100000, emv: 80000,
    } });
    // No cost baseline (BAC = 0) on an active project + no baseline lock → COST_NO_BASELINE + SCHED_NO_BASELINE.

    const review = await reviewProject(p.id);
    const set = codes(review.findings);
    expect(set.has('GOV_CHARTER_INCOMPLETE')).toBe(true);
    expect(set.has('SCOPE_MUST_UNCOVERED')).toBe(true);
    expect(set.has('SCHED_TASK_NO_OWNER')).toBe(true);
    expect(set.has('SCHED_NO_DEPENDENCIES')).toBe(true);
    expect(set.has('SCHED_NO_BASELINE')).toBe(true);
    expect(set.has('COST_NO_BASELINE')).toBe(true);
    expect(set.has('RISK_HIGH_NO_STRATEGY')).toBe(true);
    expect(set.has('RISK_HIGH_NO_OWNER')).toBe(true);
    // The category flows through for the domain-persona lens; HIGH findings exist and sort first.
    expect(review.category).toBe('CYBERSECURITY_INFRA');
    expect(review.counts.high).toBeGreaterThanOrEqual(3);
    expect(review.findings[0].severity).toBe('HIGH');
    // A specific finding carries the affected rows for deep-linking.
    const must = review.findings.find((f) => f.code === 'SCOPE_MUST_UNCOVERED');
    expect(must?.refs?.length).toBe(1);
    expect(must?.count).toBe(1);
  });

  it('a clean DRAFT project yields no HIGH findings (active-only gaps are skipped)', async () => {
    const p = await prisma.project.create({ data: { code: 'RV-2', name: 'Clean', status: 'DRAFT', deliveryApproach: 'PREDICTIVE', pmUserId: pmId } });
    await prisma.projectCharter.create({ data: {
      projectId: p.id, description: 'd', goals: 'clear goals', category: 'APP_DEV', hiScope: 'clear scope', hiDeliverables: 'clear deliverables',
      hiCostIdr: 1000, hiScheduleStart: new Date(), hiScheduleEnd: new Date(), pmUserId: pmId, locked: false,
    } });
    const review = await reviewProject(p.id);
    expect(review.counts.high).toBe(0);
    expect(review.category).toBe('APP_DEV');
  });
});
