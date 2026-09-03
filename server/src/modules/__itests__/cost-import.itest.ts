import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Excel/CSV import of Direct + Indirect budget lines. Exercised over CSV (same parser as xlsx):
// dry-run preview (counts + per-row errors), all-or-nothing commit, and RBAC.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const csv = (s: string) => Buffer.from(s.trim() + '\n', 'utf8');

let prevFlag: string | undefined;
let adminToken = '';
let viewerToken = '';
let aico = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'cico', name: 'Cost Import Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@cico.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  adminToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });
  const viewer = await prisma.user.create({ data: { name: 'viewer', email: 'viewer@cico.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: viewer.id, tenantId: aico, role: 'VIEWER' } });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email, tv: 0, tid: aico });
  const created = await request(app).post(api('/projects')).set(bearer(adminToken)).send({ name: 'Cost Import', pmUserId: owner.id });
  projectId = created.body.project.id;
  // Cost lines need a chartered (non-DRAFT) project with an unlocked baseline.
  await request(app).patch(api(`/projects/${projectId}`)).set(bearer(adminToken)).send({ status: 'CHARTERED' });
});

afterAll(async () => { if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag; });

const directUrl = (dry = true) => api(`/projects/${projectId}/cost/import/direct${dry ? '' : '?dryRun=false'}`);
const indirectUrl = (dry = true) => api(`/projects/${projectId}/cost/import/indirect${dry ? '' : '?dryRun=false'}`);
const summary = () => runWithTenant(aico, () => Promise.all([
  prisma.costItemDirect.count({ where: { projectId } }),
  prisma.costItemIndirect.count({ where: { projectId } }),
]));

const DIRECT_CSV = `
Type,Label,Sub-Category,Qty,Unit Cost,Role,Rate per Man-day,Man-days
SOFTWARE_LICENSE,Adobe CC,,5,200000,,,
MANPOWER,Backend Dev,,,,PROJECT_PERSONNEL,800000,20
OTHER,Insurance,Legal,1,500000,,,
`;
const INDIRECT_CSV = `
Type,Description,Amount
TRANSPORTATION,Taxi to site,150000
MEALS_PERDIEM,Team lunch,300000
`;

describe('cost import — direct + indirect', () => {
  it('direct dry-run previews rows and flags a bad type', async () => {
    const bad = DIRECT_CSV + 'BOGUS_TYPE,Junk,,1,1000,,,\n';
    const res = await request(app).post(directUrl()).set(bearer(adminToken)).attach('file', csv(bad), 'direct.csv');
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.total).toBe(4);
    expect(res.body.willImport).toBe(3);
    expect(res.body.errors).toHaveLength(1);
    expect((await summary())[0]).toBe(0); // nothing written on a dry run
  });

  it('commit is refused when any row is invalid (all-or-nothing)', async () => {
    const bad = DIRECT_CSV + 'MANPOWER,No Rate,,,,PM,,10\n'; // manpower missing the rate
    const res = await request(app).post(directUrl(false)).set(bearer(adminToken)).attach('file', csv(bad), 'direct.csv');
    expect(res.status).toBe(400);
    expect((await summary())[0]).toBe(0);
  });

  it('direct commit creates material + manpower lines (amounts derived)', async () => {
    const res = await request(app).post(directUrl(false)).set(bearer(adminToken)).attach('file', csv(DIRECT_CSV), 'direct.csv');
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(3);
    const rows = await runWithTenant(aico, () => prisma.costItemDirect.findMany({ where: { projectId }, select: { type: true, label: true, amount: true, manpowerCost: true } }));
    expect(rows).toHaveLength(3);
    expect(Number(rows.find((r) => r.label === 'Adobe CC')!.amount)).toBe(1_000_000); // 5 × 200000
    expect(Number(rows.find((r) => r.label === 'Backend Dev')!.manpowerCost)).toBe(16_000_000); // 800000 × 20
  });

  it('indirect commit creates lines', async () => {
    const res = await request(app).post(indirectUrl(false)).set(bearer(adminToken)).attach('file', csv(INDIRECT_CSV), 'indirect.csv');
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect((await summary())[1]).toBe(2);
  });

  it('403 for a non-writer (VIEWER)', async () => {
    const res = await request(app).post(directUrl()).set(bearer(viewerToken)).attach('file', csv(DIRECT_CSV), 'direct.csv');
    expect(res.status).toBe(403);
  });

  it('rejects a sheet missing the Type column', async () => {
    const res = await request(app).post(indirectUrl()).set(bearer(adminToken)).attach('file', csv('Description,Amount\nX,100'), 'x.csv');
    expect(res.status).toBe(400);
  });
});
