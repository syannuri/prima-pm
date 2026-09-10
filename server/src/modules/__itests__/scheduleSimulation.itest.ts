import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Schedule-risk Monte-Carlo endpoint: GET /projects/:id/schedule/simulation → finish-date
// distribution (percentiles + recommended finish) + per-activity criticality index.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let ownerToken = '';
let tenantId = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'mcsched', name: 'MC Sched Co' } });
  tenantId = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@mcsched.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: tenantId });

  await runWithTenant(tenantId, async () => {
    const proj = await prisma.project.create({
      data: { code: 'MCS-1', name: 'MC Sched Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
      select: { id: true },
    });
    projectId = proj.id;
    // A → B → C chain, each ~10 days (finite finish, single critical path).
    const mk = (wbs: string, name: string, s: string, e: string) =>
      prisma.task.create({ data: { projectId, wbsCode: wbs, name, planStart: new Date(s), planEnd: new Date(e) }, select: { id: true } });
    const A = await mk('1', 'A', '2026-01-01', '2026-01-10');
    const B = await mk('2', 'B', '2026-01-11', '2026-01-20');
    const C = await mk('3', 'C', '2026-01-21', '2026-01-30');
    await prisma.taskDependency.create({ data: { predecessorId: A.id, successorId: B.id, type: 'FS', lagDays: 0 } });
    await prisma.taskDependency.create({ data: { predecessorId: B.id, successorId: C.id, type: 'FS', lagDays: 0 } });
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

const url = () => api(`/projects/${projectId}/schedule/simulation`);

describe('schedule-risk Monte-Carlo endpoint', () => {
  it('rejects unauthenticated access', async () => {
    await request(app).get(url()).expect(401);
  });

  it('returns a finish distribution with a criticality index for the chain', async () => {
    const res = await request(app).get(url()).query({ iterations: 4000, confidence: 0.8 }).set(bearer(ownerToken)).expect(200);
    expect(res.body.hasNetwork).toBe(true);
    expect(res.body.activityCount).toBe(3);
    expect(res.body.deterministicDays).toBeGreaterThan(0);
    // Monotonic ladder + reserve == the confidence percentile.
    const { p50, p80, p90, p95 } = res.body.percentiles;
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
    expect(res.body.recommendedDays).toBe(p80);
    // Single chain → every activity is always critical.
    const idx = new Map(res.body.criticality.map((c: { name: string; index: number }) => [c.name, c.index]));
    expect(idx.get('A')).toBe(1);
    expect(idx.get('B')).toBe(1);
    expect(idx.get('C')).toBe(1);
    // Finish dates surfaced for the UI.
    expect(new Date(res.body.recommendedFinish).getTime()).toBeGreaterThan(new Date(res.body.projectStart).getTime());
  });

  it('is reproducible (seeded per project) across calls', async () => {
    const a = await request(app).get(url()).query({ iterations: 3000 }).set(bearer(ownerToken)).expect(200);
    const b = await request(app).get(url()).query({ iterations: 3000 }).set(bearer(ownerToken)).expect(200);
    expect(b.body).toEqual(a.body);
  });
});
