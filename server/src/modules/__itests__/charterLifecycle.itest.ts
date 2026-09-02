import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Charter stays EDITABLE through DRAFT + CHARTERED (planning) and is frozen (locked) only when the
// project is activated (CHARTERED → IN_PROGRESS). After that, edits need a Change Request.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let adminToken = '';
let aico = '';
let ownerId = '';
let projectId = '';

const charterBody = (over: Record<string, unknown> = {}) => ({
  description: 'A solid project description.',
  goals: 'Deliver the thing on time.',
  category: 'APP_DEV',
  hiScope: 'Build and ship the application.',
  hiCostIdr: 1_000_000,
  hiScheduleStart: '2026-01-05',
  hiScheduleEnd: '2026-03-05',
  hiDeliverables: 'A working app, docs, and training.',
  pmUserId: ownerId,
  deliveryApproach: 'PREDICTIVE',
  ...over,
});

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'chco', name: 'Charter Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@chco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  adminToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });
  const created = await request(app).post(api('/projects')).set(bearer(adminToken)).send({ name: 'Charter Lifecycle', pmUserId: ownerId });
  projectId = created.body.project.id;
});

afterAll(async () => { if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag; });

const putCharter = (over = {}) => request(app).put(api(`/projects/${projectId}/charter`)).set(bearer(adminToken)).send(charterBody(over));
const getCharter = () => runWithTenant(aico, () => prisma.projectCharter.findUnique({ where: { projectId } }));
const getProject = () => runWithTenant(aico, () => prisma.project.findUnique({ where: { id: projectId }, select: { status: true } }));

describe('charter editable until activation', () => {
  it('created and committed → project is CHARTERED but the charter is NOT locked', async () => {
    expect((await putCharter()).status).toBe(200);
    const commit = await request(app).post(api(`/projects/${projectId}/charter/commit`)).set(bearer(adminToken));
    expect(commit.status).toBe(200);
    expect((await getProject())?.status).toBe('CHARTERED');
    const c = await getCharter();
    expect(c?.locked).toBe(false); // still editable
    expect(c?.committedAt).not.toBeNull();
  });

  it('the charter can still be edited directly while CHARTERED (no Change Request)', async () => {
    const res = await putCharter({ description: 'Edited during the planning phase.' });
    expect(res.status).toBe(200);
    expect((await getCharter())?.description).toBe('Edited during the planning phase.');
  });

  it('optional hiResources round-trips (saved when present, nulled when blank)', async () => {
    expect((await putCharter({ hiResources: '- 1 PM\n- 2 backend engineers' })).status).toBe(200);
    expect((await getCharter())?.hiResources).toBe('- 1 PM\n- 2 backend engineers');
    // Blank/whitespace normalises back to null (doesn't block the required-fields gate).
    expect((await putCharter({ hiResources: '   ' })).status).toBe(200);
    expect((await getCharter())?.hiResources).toBeNull();
  });

  it('activation freezes the charter (locked) and snapshots a version', async () => {
    const act = await request(app).patch(api(`/projects/${projectId}`)).set(bearer(adminToken))
      .send({ status: 'IN_PROGRESS', forceActivate: true, activateReason: 'test activation' });
    expect(act.status).toBe(200);
    expect((await getCharter())?.locked).toBe(true);
    const versions = await runWithTenant(aico, () => prisma.charterVersion.count({ where: { projectId } }));
    expect(versions).toBeGreaterThanOrEqual(1);
  });

  it('after activation a direct edit is blocked (needs a Change Request)', async () => {
    const res = await putCharter({ description: 'Trying to edit an active project.' });
    expect(res.status).toBe(409);
  });
});
