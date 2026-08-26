import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Time-phased cash-flow view (GET /projects/:id/cashflow). Exercises the route wiring, auth, the
// granularity param and the AC / committed roll-ups over a real planned window. PV time-phasing
// maths is covered by cashflow.periods.test.ts (pure).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const U = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

let prevFlag: string | undefined;
let ownerToken = '';
let tenantId = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'cashco', name: 'Cash Co' } });
  tenantId = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@cashco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: tenantId });

  await runWithTenant(tenantId, async () => {
    const proj = await prisma.project.create({
      data: { code: 'CASH-1', name: 'Cash Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
      select: { id: true },
    });
    projectId = proj.id;
    // Planned window Jan 1 – Mar 31 2026 (→ monthly buckets Jan/Feb/Mar).
    await prisma.task.createMany({
      data: [
        { projectId, wbsCode: '1', name: 'Design', planStart: U(2026, 0, 1), planEnd: U(2026, 1, 15) },
        { projectId, wbsCode: '2', name: 'Build', planStart: U(2026, 1, 16), planEnd: U(2026, 2, 31) },
      ],
    });
    // Actual cost entries: 100 in Jan, 50 in early Feb (both before the Feb-15 status date).
    await prisma.actualCostEntry.createMany({
      data: [
        { projectId, date: U(2026, 0, 15), amount: 100 },
        { projectId, date: U(2026, 1, 5), amount: 50 },
      ],
    });
    // An obligated PO (AWARDED) needed Feb 20 → committed in the Feb bucket. A PLANNED one must NOT count.
    await prisma.procurement.createMany({
      data: [
        { projectId, code: 'PO-1', title: 'Servers', status: 'AWARDED', amount: 200, needBy: U(2026, 1, 20) },
        { projectId, code: 'PO-2', title: 'Pipeline', status: 'PLANNED', amount: 999, needBy: U(2026, 1, 25) },
      ],
    });
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

const url = (q = '') => api(`/projects/${projectId}/cashflow${q}`);

describe('Cash-flow / time-phased budget — GET /projects/:id/cashflow', () => {
  it('401 without a token', async () => {
    const res = await request(app).get(url());
    expect(res.status).toBe(401);
  });

  it('400 on an invalid granularity', async () => {
    const res = await request(app).get(url('?granularity=daily')).set(bearer(ownerToken));
    expect(res.status).toBe(400);
  });

  it('returns monthly buckets across the planned window', async () => {
    const res = await request(app).get(url('?statusDate=2026-02-15&granularity=month')).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(true);
    expect(res.body.granularity).toBe('month');
    expect(res.body.periods.map((p: { key: string }) => p.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('rolls up actual cost to the status date', async () => {
    const res = await request(app).get(url('?statusDate=2026-02-15')).set(bearer(ownerToken));
    expect(res.body.summary.acToDate).toBe(150); // 100 + 50
    const [jan, feb, mar] = res.body.periods;
    expect(jan.actual).toBe(100);
    expect(feb.actual).toBe(50);
    expect(mar.actual).toBeNull(); // future
  });

  it('buckets only obligated POs into committed cost', async () => {
    const res = await request(app).get(url('?statusDate=2026-02-15')).set(bearer(ownerToken));
    expect(res.body.summary.totalCommitted).toBe(200); // AWARDED only, PLANNED excluded
    const feb = res.body.periods.find((p: { key: string }) => p.key === '2026-02');
    expect(feb.committed).toBe(200);
  });

  it('supports quarter granularity', async () => {
    const res = await request(app).get(url('?statusDate=2026-02-15&granularity=quarter')).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.periods.map((p: { key: string }) => p.key)).toEqual(['2026-Q1']);
  });
});
