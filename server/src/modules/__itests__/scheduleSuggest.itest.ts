import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { ScheduleDraftSchema, type ScheduleDraft } from '../schedule/scheduleSuggest.service.js';

// AI timeline generation — drafts a WBS/timeline from the charter via an injectable port (no
// network, no key). Exercises the two gates (global env + per-tenant opt-in), write authorization,
// the draft shape, and the deterministic apply (phases → work packages, empty seed + append).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const DRAFT: ScheduleDraft = {
  phases: [
    { name: 'Planning', deliverable: 'Plan', tasks: [
      { name: 'Requirements', durationDays: 5, deliverable: 'SRS', resourceRole: 'Business Analyst' },
      { name: 'Design', durationDays: 5, resourceRole: 'Backend Engineer', resourceRef: 'r1' },
    ] },
    { name: 'Delivery', tasks: [
      { name: 'Kick-off', durationDays: 0, isMilestone: true },
      { name: 'Build', durationDays: 10, weight: 30, resourceRole: 'Backend Engineer', resourceRef: 'r1' },
    ] },
  ],
};
// Capture the last user payload so a test can assert the resource pool was assembled + passed in.
let capturedUser = '';
const fakePort: AiPort = { async draftJson({ user }) { capturedUser = user; return DRAFT; }, async draftNarrative() { return null; } };

let prevFlag: string | undefined;
let prevKey: string | undefined;
let platformToken = '';
let ownerToken = '';   // ADMIN (can write schedule)
let viewerToken = '';  // VIEWER (cannot write)
let aico = '';
let projectId = '';
let ownerId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(fakePort);

  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@sched.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'schedco', name: 'Sched Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@schedco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });

  const viewer = await prisma.user.create({ data: { name: 'viewer', email: 'viewer@schedco.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: viewer.id, tenantId: aico, role: 'VIEWER' } });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email, tv: 0, tid: aico });

  projectId = await runWithTenant(aico, async () => {
    const proj = await prisma.project.create({
      data: { code: 'SCH-1', name: 'Sched Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
      select: { id: true },
    });
    await prisma.projectCharter.create({
      data: {
        projectId: proj.id, description: 'desc', goals: 'goals', category: 'APP_DEV',
        hiScope: 'Build the thing', hiCostIdr: 0, hiDeliverables: 'A, B, C',
        hiScheduleStart: new Date('2026-01-05'), hiScheduleEnd: new Date('2026-03-05'),
        pmUserId: owner.id,
        hiResources: '- 1 Backend Engineer\n- 1 QA Engineer',
      },
    });
    // A register resource (structured capacity) — pooled with the narrative roles for the AI.
    await prisma.resource.create({ data: { name: 'Andi', roleTitle: 'Backend Engineer', capacityPerDay: 1 } });
    return proj.id;
  });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

const genUrl = () => api(`/projects/${projectId}/schedule/ai-generate`);
const applyUrl = () => api(`/projects/${projectId}/schedule/apply-ai-draft`);

describe('AI timeline — schedule/ai-generate + apply-ai-draft', () => {
  it('the injected draft validates against the shared schema', () => {
    expect(ScheduleDraftSchema.safeParse(DRAFT).success).toBe(true);
  });

  it('503 when the global gate is off (ANTHROPIC_API_KEY unset)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post(genUrl()).set(bearer(ownerToken));
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_DISABLED');
  });

  it('403 when a non-writer (VIEWER) calls generate', async () => {
    const res = await request(app).post(genUrl()).set(bearer(viewerToken));
    expect(res.status).toBe(403);
  });

  it('403 when the tenant has not opted in', async () => {
    const res = await request(app).post(genUrl()).set(bearer(ownerToken));
    expect(res.status).toBe(403);
  });

  it('200 returns a structured draft + charter meta once the tenant opts in', async () => {
    await request(app).patch(api(`/admin/tenants/${aico}`)).set(bearer(platformToken)).send({ aiNarrativeEnabled: true });
    const res = await request(app).post(genUrl()).set(bearer(ownerToken)).send({ lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.draft).toEqual(DRAFT);
    expect(res.body.charter.scheduleWorkingDaysBudget).toBeGreaterThan(0);
  });

  it('assembles the resource pool (register + charter hiResources) into the AI payload', async () => {
    await request(app).post(genUrl()).set(bearer(ownerToken)).send({ lang: 'en' });
    const payload = JSON.parse(capturedUser);
    const labels = payload.availableResources.map((r: { label: string }) => r.label);
    // Register row comes first (name · role); the narrative QA role supplements it; the register's
    // Backend Engineer role de-dupes the narrative "Backend Engineer" line.
    expect(labels).toContain('Andi · Backend Engineer');
    expect(labels).toContain('QA Engineer');
    expect(labels).not.toContain('Backend Engineer'); // narrative dup dropped in favour of the register row
    expect(payload.availableResources.every((r: { capacityPerDay: number }) => r.capacityPerDay > 0)).toBe(true);
  });

  it('502 when the model declines / returns nothing', async () => {
    __setAiPort({ async draftJson() { return null; }, async draftNarrative() { return null; } });
    const res = await request(app).post(genUrl()).set(bearer(ownerToken));
    __setAiPort(fakePort);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('apply seeds the WBS + a sequential FS chain (link on by default)', async () => {
    const res = await request(app).post(applyUrl()).set(bearer(ownerToken)).send(DRAFT);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(6); // 2 phases + 4 tasks
    expect(res.body.phases).toBe(2);
    expect(res.body.links).toBe(3); // 4 work packages chained → 3 FS links (no AI refs → fallback)

    const tasks = await runWithTenant(aico, () => prisma.task.findMany({ where: { projectId }, select: { id: true, name: true, parentTaskId: true, isMilestone: true } }));
    expect(tasks).toHaveLength(6);
    const planning = tasks.find((t) => t.name === 'Planning')!;
    const requirements = tasks.find((t) => t.name === 'Requirements')!;
    expect(planning.parentTaskId).toBeNull();
    expect(requirements.parentTaskId).toBe(planning.id); // child points at its phase
    expect(tasks.find((t) => t.name === 'Kick-off')!.isMilestone).toBe(true);
    const depCount = await runWithTenant(aico, () => prisma.taskDependency.count({ where: { predecessor: { projectId } } }));
    expect(depCount).toBe(3);
  });

  it('apply again APPENDS onto the existing schedule (no wipe)', async () => {
    const res = await request(app).post(applyUrl()).set(bearer(ownerToken)).send(DRAFT);
    expect(res.status).toBe(201);
    const count = await runWithTenant(aico, () => prisma.task.count({ where: { projectId } }));
    expect(count).toBe(12); // appended, not replaced
    const depCount = await runWithTenant(aico, () => prisma.taskDependency.count({ where: { predecessor: { projectId } } }));
    expect(depCount).toBe(6); // +3 for the appended block; existing tasks are never re-linked
  });

  it('link=false appends without creating any dependencies', async () => {
    const res = await request(app).post(applyUrl()).set(bearer(ownerToken)).send({ ...DRAFT, link: false });
    expect(res.status).toBe(201);
    expect(res.body.links).toBe(0);
    const [count, depCount] = await runWithTenant(aico, () => Promise.all([
      prisma.task.count({ where: { projectId } }),
      prisma.taskDependency.count({ where: { predecessor: { projectId } } }),
    ]));
    expect(count).toBe(18); // +6 rows
    expect(depCount).toBe(6); // unchanged
  });

  it('honours an AI-provided FS graph (parallel + merge)', async () => {
    const linked = { phases: [
      { name: 'Build phase', tasks: [
        { name: 'WP-A', durationDays: 4, ref: 'a' },
        { name: 'WP-B', durationDays: 4, ref: 'b', deps: ['a'] },
        { name: 'WP-C', durationDays: 3, ref: 'c', deps: ['a'] }, // parallel with B
        { name: 'WP-D', durationDays: 2, ref: 'd', deps: ['b', 'c'] }, // merge
      ] },
    ] };
    const res = await request(app).post(applyUrl()).set(bearer(ownerToken)).send(linked);
    expect(res.status).toBe(201);
    expect(res.body.links).toBe(4); // a→b, a→c, b→d, c→d
  });

  it('resource-levels same-resource parallel branches + assigns owners (Phase 3)', async () => {
    // Two register resources (capacity 1 each) so the pool has real ids to own + level against.
    const { p3, andiId, bellaId } = await runWithTenant(aico, async () => {
      const andi = await prisma.resource.findFirst({ where: { name: 'Andi' }, select: { id: true } });
      const bella = await prisma.resource.create({ data: { name: 'Bella', roleTitle: 'Designer', capacityPerDay: 1 }, select: { id: true } });
      const proj = await prisma.project.create({ data: { code: 'SCH-LVL', name: 'Leveling', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
      await prisma.projectCharter.create({ data: {
        projectId: proj.id, description: 'd', goals: 'g', category: 'APP_DEV', hiScope: 's', hiCostIdr: 0, hiDeliverables: 'a',
        hiScheduleStart: new Date('2026-01-05'), hiScheduleEnd: new Date('2026-06-05'), pmUserId: ownerId,
      } });
      return { p3: proj.id, andiId: andi!.id, bellaId: bella.id };
    });

    // Kick-off then three branches: A & B both need r1 (Andi) → must serialise; C needs r2 (Bella) → parallel.
    const draft = { phases: [{ name: 'Build', tasks: [
      { name: 'Kick-off', durationDays: 0, isMilestone: true, ref: 'k' },
      { name: 'Backend A', durationDays: 5, ref: 'a', deps: ['k'], resourceRef: 'r1' },
      { name: 'Backend B', durationDays: 5, ref: 'b', deps: ['k'], resourceRef: 'r1' },
      { name: 'Design C', durationDays: 5, ref: 'c', deps: ['k'], resourceRef: 'r2' },
    ] }] };
    const res = await request(app).post(api(`/projects/${p3}/schedule/apply-ai-draft`)).set(bearer(ownerToken)).send(draft);
    expect(res.status).toBe(201);
    expect(res.body.links).toBe(4);        // 3 AI (k→a,k→b,k→c) + 1 leveling (a→b)
    expect(res.body.levelingLinks).toBe(1);
    expect(res.body.assigned).toBe(3);     // A,B → Andi; C → Bella; the milestone has no resource

    const tasks = await runWithTenant(aico, () => prisma.task.findMany({
      where: { projectId: p3 }, select: { name: true, planStart: true, planEnd: true, picResourceId: true },
    }));
    const byName = (n: string) => tasks.find((t) => t.name === n)!;
    const A = byName('Backend A'), B = byName('Backend B'), C = byName('Design C');
    // Same resource → B starts only after A finishes (no overlap).
    expect(+B.planStart).toBeGreaterThanOrEqual(+A.planEnd);
    // Different resource → C runs in parallel with A (overlaps it, not pushed after).
    expect(+C.planStart).toBeLessThan(+A.planEnd);
    // Owners were auto-assigned from the matched register resources.
    expect(A.picResourceId).toBe(andiId);
    expect(B.picResourceId).toBe(andiId);
    expect(C.picResourceId).toBe(bellaId);
    const ownerCount = await runWithTenant(aico, () => prisma.taskOwner.count({ where: { task: { projectId: p3 } } }));
    expect(ownerCount).toBe(3);
  });

  it('level=false skips leveling (same-resource branches may overlap)', async () => {
    const { p4 } = await runWithTenant(aico, async () => {
      const proj = await prisma.project.create({ data: { code: 'SCH-NOLVL', name: 'No level', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
      await prisma.projectCharter.create({ data: {
        projectId: proj.id, description: 'd', goals: 'g', category: 'APP_DEV', hiScope: 's', hiCostIdr: 0, hiDeliverables: 'a',
        hiScheduleStart: new Date('2026-01-05'), hiScheduleEnd: new Date('2026-06-05'), pmUserId: ownerId,
      } });
      return { p4: proj.id };
    });
    const draft = { phases: [{ name: 'Build', tasks: [
      { name: 'Kick-off', durationDays: 0, isMilestone: true, ref: 'k' },
      { name: 'A2', durationDays: 5, ref: 'a', deps: ['k'], resourceRef: 'r1' },
      { name: 'B2', durationDays: 5, ref: 'b', deps: ['k'], resourceRef: 'r1' },
    ] }] };
    const res = await request(app).post(api(`/projects/${p4}/schedule/apply-ai-draft`)).set(bearer(ownerToken)).send({ ...draft, level: false });
    expect(res.status).toBe(201);
    expect(res.body.levelingLinks).toBe(0);
    expect(res.body.links).toBe(2); // only the AI k→a, k→b
  });

  it('fit=true scales an overrunning draft to land on the charter end', async () => {
    // Fresh project with a 30-day charter window; draft totals 100 days → must be scaled down.
    const p2 = await runWithTenant(aico, async () => {
      const proj = await prisma.project.create({ data: { code: 'SCH-FIT', name: 'Fit', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
      await prisma.projectCharter.create({ data: {
        projectId: proj.id, description: 'd', goals: 'g', category: 'APP_DEV', hiScope: 's', hiCostIdr: 0, hiDeliverables: 'a',
        hiScheduleStart: new Date('2026-01-05'), hiScheduleEnd: new Date('2026-02-04'), pmUserId: ownerId, // 30-day window
      } });
      return proj.id;
    });
    const big = { phases: [{ name: 'Phase', tasks: [{ name: 'Big one', durationDays: 50 }, { name: 'Big two', durationDays: 50 }] }] };
    const res = await request(app).post(api(`/projects/${p2}/schedule/apply-ai-draft`)).set(bearer(ownerToken))
      .send({ ...big, link: false, fit: true, startDate: '2026-01-05' });
    expect(res.status).toBe(201);
    // link off → pure calendar dates → projected end lands exactly on the charter end.
    expect(new Date(res.body.projectedEnd).toISOString().slice(0, 10)).toBe('2026-02-04');
  });

  it('403 when a non-writer (VIEWER) calls apply', async () => {
    const res = await request(app).post(applyUrl()).set(bearer(viewerToken)).send(DRAFT);
    expect(res.status).toBe(403);
  });
});
