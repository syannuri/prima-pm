import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Cross-project schedule dependencies (Tier-3): link a successor task in one project to a predecessor
// task in another, with schedule-impact detection. Verifies creation + late detection, incoming/outgoing
// listing, the same-project guard, and tenant isolation.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const d = (s: string) => new Date(s);

let prevFlag: string | undefined;
let adminA = '';
let adminB = '';
let p1 = ''; // predecessor project
let p2 = ''; // successor project
let t1 = ''; // predecessor task (finishes late)
let t2 = ''; // successor task (starts early)

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'xda', name: 'XD A' } });
  const b = await prisma.tenant.create({ data: { slug: 'xdb', name: 'XD B' } });

  const admin = await prisma.user.create({ data: { name: 'adm', email: 'adm@xda.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: a.id, role: 'ADMIN' } });
  adminA = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: a.id });

  const badmin = await prisma.user.create({ data: { name: 'admb', email: 'adm@xdb.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: badmin.id, tenantId: b.id, role: 'ADMIN' } });
  adminB = signAccessToken({ sub: badmin.id, role: 'ADMIN', email: badmin.email, tv: 0, tid: b.id });

  await runWithTenant(a.id, async () => {
    const pr1 = await prisma.project.create({ data: { code: 'XD-P1', name: 'Upstream', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: admin.id, tenantId: a.id } });
    const pr2 = await prisma.project.create({ data: { code: 'XD-P2', name: 'Downstream', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: admin.id, tenantId: a.id } });
    p1 = pr1.id; p2 = pr2.id;
    // Predecessor finishes 2026-06-30; successor starts 2026-06-01 → predecessor is LATE for the successor.
    const ta = await prisma.task.create({ data: { projectId: p1, wbsCode: '1', name: 'Build API', planStart: d('2026-06-01'), planEnd: d('2026-06-30') } });
    const tb = await prisma.task.create({ data: { projectId: p2, wbsCode: '1', name: 'Integrate API', planStart: d('2026-06-01'), planEnd: d('2026-06-20') } });
    t1 = ta.id; t2 = tb.id;
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('cross-project dependencies', () => {
  let linkId = '';

  it('creates a cross-project link and flags the late predecessor', async () => {
    const res = await request(app).post(api(`/projects/${p2}/cross-deps`)).set(bearer(adminA))
      .send({ predecessorTaskId: t1, successorTaskId: t2 });
    expect(res.status).toBe(201);
    expect(res.body.link.predecessor.projectCode).toBe('XD-P1');
    expect(res.body.link.successor.projectCode).toBe('XD-P2');
    expect(res.body.link.late).toBe(true); // pred finish 06-30 > succ start 06-01
    linkId = res.body.link.id;
  });

  it('rejects a same-project link', async () => {
    // t2 depends on itself is a self-link; a same-project pair is also rejected. Use the self case here.
    const res = await request(app).post(api(`/projects/${p2}/cross-deps`)).set(bearer(adminA))
      .send({ predecessorTaskId: t2, successorTaskId: t2 });
    expect(res.status).toBe(400);
  });

  it('lists the link as incoming for the successor and outgoing for the predecessor', async () => {
    const down = await request(app).get(api(`/projects/${p2}/cross-deps`)).set(bearer(adminA));
    expect(down.status).toBe(200);
    expect(down.body.incoming).toHaveLength(1);
    expect(down.body.outgoing).toHaveLength(0);

    const up = await request(app).get(api(`/projects/${p1}/cross-deps`)).set(bearer(adminA));
    expect(up.body.outgoing).toHaveLength(1);
    expect(up.body.incoming).toHaveLength(0);
  });

  it('isolates across tenants (a foreign admin cannot see the project)', async () => {
    const res = await request(app).get(api(`/projects/${p2}/cross-deps`)).set(bearer(adminB));
    expect(res.status).toBe(404);
  });

  it('deletes the link', async () => {
    const del = await request(app).delete(api(`/projects/${p2}/cross-deps/${linkId}`)).set(bearer(adminA));
    expect(del.status).toBe(204);
    const after = await request(app).get(api(`/projects/${p2}/cross-deps`)).set(bearer(adminA));
    expect(after.body.incoming).toHaveLength(0);
  });
});
