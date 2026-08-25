import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Stage B — predictive route wiring + auth. The heuristic itself is unit-tested in
// predictive/__tests__/predictive.test.ts; this proves the endpoint + access control + the
// no-data path. Deterministic → no AI key needed (works with the gate off).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let ownerToken = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'predco', name: 'Pred Co' } });
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@predco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: t.id, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: t.id });

  const proj = await runWithTenant(t.id, () => prisma.project.create({
    data: { code: 'PRED-1', name: 'Pred Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
    select: { id: true },
  }));
  projectId = proj.id;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('predictive signals — GET /projects/:id/predictive', () => {
  it('401 without auth', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/predictive`));
    expect(res.status).toBe(401);
  });

  it('200 with hasData:false for a project with no progress/cost yet', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/predictive`)).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasData: false, slip: null, overrun: null });
  });
});
