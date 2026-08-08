// =====================================================================
// Guest onboarding seed — when a brand-new GUEST is provisioned (self
// signup or first Google sign-in) we plant two fully-populated demo
// projects in their personal tenant so the sandbox never opens empty:
//   1) a PREDICTIVE project (charter + WBS schedule + cost baseline +
//      actuals → Gantt, S-curve and EVM gauges all render), and
//   2) an AGILE project (charter + sprints + backlog + cost → board,
//      burndown and agile EVM render).
// It runs through the real service layer (same path as prisma/seed.ts)
// inside the guest's tenant context, and is strictly best-effort: any
// failure is swallowed so it can NEVER block the login/critical path.
// =====================================================================
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';

import * as projects from '../projects/projects.service.js';
import * as charter from '../charter/charter.service.js';
import * as cost from '../cost/cost.service.js';
import * as schedule from '../schedule/schedule.service.js';
import * as agile from '../agile/agile.service.js';
import { getProjectEvm } from '../agile/agile.service.js';

import { upsertCharterSchema } from '../charter/charter.schemas.js';
import { directLineSchema, indirectLineSchema, actualCostSchema } from '../cost/cost.schemas.js';
import { upsertTaskSchema } from '../schedule/schedule.schemas.js';
import { sprintSchema, backlogItemSchema } from '../agile/agile.schemas.js';

// ---- date helpers: everything is relative to "now" so a guest who signs up in
// any month sees an in-flight project (past = done, around now = in progress). ---
const DAY = 86_400_000;
function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * DAY).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// 1) PREDICTIVE — "Website Revamp & SEO Launch"
// ---------------------------------------------------------------------
async function seedPredictive(actorId: string): Promise<string> {
  const project = await projects.createProject(
    { name: 'Website Revamp & SEO Launch', sponsor: 'Marketing', deliveryApproach: 'PREDICTIVE' },
    actorId,
    'GUEST',
  );

  await charter.upsertCharter(
    project.id,
    upsertCharterSchema.parse({
      description:
        'Rebuild the public corporate website on a modern stack and relaunch with a technical-SEO and content overhaul.',
      goals: 'Cut page-load time in half, lift organic traffic by 40%, and modernize the brand.',
      category: 'DIGITAL_TRANSFORMATION',
      hiScope: 'UX research, design system, front-end build, content & SEO, QA/performance, go-live & handover.',
      hiCostIdr: 250_000_000,
      hiScheduleStart: iso(-60),
      hiScheduleEnd: iso(75),
      hiDeliverables: 'New responsive website, design system, SEO-optimized content, analytics dashboards.',
      pmUserId: actorId,
    }),
    actorId,
  );
  await charter.commitCharter(project.id, actorId);

  // ---- WBS: 3 phases, 6 leaf tasks (done → in-progress → not-started) ----
  const p1 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Phase 1 — Discovery & Design', planStart: iso(-60), planEnd: iso(-25), sortOrder: 1 }),
    actorId,
  );
  const t11 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Requirements & UX research', parentTaskId: p1.id, planStart: iso(-60), planEnd: iso(-45), picUserId: actorId, progressPct: 100, actualStart: iso(-60), actualFinish: iso(-44), sortOrder: 1 }),
    actorId,
  );
  const t12 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'UI design system & mockups', parentTaskId: p1.id, planStart: iso(-44), planEnd: iso(-25), picUserId: actorId, progressPct: 100, actualStart: iso(-43), actualFinish: iso(-24), sortOrder: 2 }),
    actorId,
  );

  const p2 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Phase 2 — Build & Content', planStart: iso(-24), planEnd: iso(30), sortOrder: 2 }),
    actorId,
  );
  const t21 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Front-end development', parentTaskId: p2.id, planStart: iso(-24), planEnd: iso(20), picUserId: actorId, progressPct: 60, actualStart: iso(-22), sortOrder: 1 }),
    actorId,
  );
  const t22 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Content & SEO copywriting', parentTaskId: p2.id, planStart: iso(-10), planEnd: iso(30), picUserId: actorId, progressPct: 25, actualStart: iso(-8), sortOrder: 2 }),
    actorId,
  );

  const p3 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Phase 3 — Launch', planStart: iso(31), planEnd: iso(75), sortOrder: 3 }),
    actorId,
  );
  await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'QA & performance tuning', parentTaskId: p3.id, planStart: iso(31), planEnd: iso(55), picUserId: actorId, progressPct: 0, sortOrder: 1 }),
    actorId,
  );
  await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Go-live & handover', parentTaskId: p3.id, planStart: iso(56), planEnd: iso(75), picUserId: actorId, progressPct: 0, sortOrder: 2 }),
    actorId,
  );

  // Design system must finish before front-end build starts.
  await schedule.addDependency(project.id, t21.id, { predecessorId: t12.id, type: 'FS', lagDays: 0 }, actorId);

  // ---- Cost baseline: material + manpower (task-linked) + indirect ----
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'SOFTWARE_LICENSE', label: 'Design & analytics tools (annual)', qty: 1, unitCost: 24_000_000 }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'TECHNOLOGY_CLOUD', label: 'Cloud hosting & CDN (1 yr)', qty: 1, unitCost: 36_000_000 }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'UX Researcher', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 1_500_000, planMandays: 12, taskId: t11.id }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'UI Designer', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 1_800_000, planMandays: 15, taskId: t12.id }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'Front-end Engineer', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 2_000_000, planMandays: 45, taskId: t21.id }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'Content & SEO Specialist', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 1_200_000, planMandays: 20, taskId: t22.id }), actorId);
  await cost.addIndirectLine(project.id, indirectLineSchema.parse({ type: 'MEETING_VENUE', description: 'Stakeholder review workshops', amount: 6_000_000 }), actorId);

  // ---- Time-phased actuals (feed CPI / S-curve) ----
  await cost.addActualCost(project.id, actualCostSchema.parse({ date: iso(-40), amount: 42_000_000, description: 'Discovery & design phase' }), actorId);
  await cost.addActualCost(project.id, actualCostSchema.parse({ date: iso(-10), amount: 55_000_000, description: 'Build sprint & tooling' }), actorId);

  return project.id;
}

// ---------------------------------------------------------------------
// 2) AGILE — "Mobile App MVP (iOS & Android)"
// ---------------------------------------------------------------------
async function seedAgile(actorId: string): Promise<string> {
  const project = await projects.createProject(
    { name: 'Mobile App MVP (iOS & Android)', sponsor: 'Product', deliveryApproach: 'AGILE' },
    actorId,
    'GUEST',
  );

  await charter.upsertCharter(
    project.id,
    upsertCharterSchema.parse({
      description: 'Ship a cross-platform mobile MVP covering onboarding, core workflow and push notifications.',
      goals: 'Validate the product with 1,000 beta users and reach a 4.5★ store rating.',
      category: 'APP_DEV',
      hiScope: 'Onboarding, auth, core feature set, offline sync, push notifications, app-store release.',
      hiCostIdr: 300_000_000,
      hiScheduleStart: iso(-38),
      hiScheduleEnd: iso(90),
      hiDeliverables: 'Published iOS & Android apps, backend API, admin console, analytics.',
      pmUserId: actorId,
      deliveryApproach: 'AGILE',
    }),
    actorId,
  );
  await charter.commitCharter(project.id, actorId);

  await agile.setMandaysPerPoint(project.id, 1, actorId);

  // ---- Sprints: 2 closed, 1 active, 1 planned ----
  const s1 = await agile.createSprint(project.id, sprintSchema.parse({ name: 'Sprint 1 — Foundations', goal: 'Project setup, design system, auth', startDate: iso(-38), endDate: iso(-24), status: 'CLOSED' }), actorId);
  const s2 = await agile.createSprint(project.id, sprintSchema.parse({ name: 'Sprint 2 — Onboarding', goal: 'Sign-up flow & profile', startDate: iso(-23), endDate: iso(-9), status: 'CLOSED' }), actorId);
  const s3 = await agile.createSprint(project.id, sprintSchema.parse({ name: 'Sprint 3 — Core workflow', goal: 'Main feature & offline sync', startDate: iso(-8), endDate: iso(6), status: 'ACTIVE' }), actorId);
  const s4 = await agile.createSprint(project.id, sprintSchema.parse({ name: 'Sprint 4 — Notifications', goal: 'Push & deep links', startDate: iso(7), endDate: iso(21), status: 'PLANNED' }), actorId);

  // ---- Backlog: mix of done / in-progress / todo across the sprints + product backlog ----
  const items: Array<{ title: string; type?: string; storyPoints: number; status: string; sprintId?: string; priority: number }> = [
    // Sprint 1 (closed → done)
    { title: 'Project scaffolding & CI/CD', type: 'TASK', storyPoints: 5, status: 'DONE', sprintId: s1.id, priority: 1 },
    { title: 'Shared UI component library', type: 'STORY', storyPoints: 8, status: 'DONE', sprintId: s1.id, priority: 2 },
    { title: 'Email & Google authentication', type: 'STORY', storyPoints: 5, status: 'DONE', sprintId: s1.id, priority: 3 },
    // Sprint 2 (closed → done, one deferred)
    { title: 'Onboarding walkthrough screens', type: 'STORY', storyPoints: 5, status: 'DONE', sprintId: s2.id, priority: 4 },
    { title: 'User profile & settings', type: 'STORY', storyPoints: 8, status: 'DONE', sprintId: s2.id, priority: 5 },
    { title: 'Avatar upload & image crop', type: 'STORY', storyPoints: 3, status: 'DEFERRED', sprintId: s2.id, priority: 6 },
    // Sprint 3 (active → mixed)
    { title: 'Core workflow — list & detail', type: 'STORY', storyPoints: 8, status: 'DONE', sprintId: s3.id, priority: 7 },
    { title: 'Offline sync & local cache', type: 'STORY', storyPoints: 8, status: 'IN_PROGRESS', sprintId: s3.id, priority: 8 },
    { title: 'Search & filters', type: 'STORY', storyPoints: 5, status: 'IN_PROGRESS', sprintId: s3.id, priority: 9 },
    { title: 'Empty & error states', type: 'TASK', storyPoints: 3, status: 'TODO', sprintId: s3.id, priority: 10 },
    // Sprint 4 (planned → todo)
    { title: 'Push notification service', type: 'STORY', storyPoints: 8, status: 'TODO', sprintId: s4.id, priority: 11 },
    { title: 'Deep links & routing', type: 'STORY', storyPoints: 5, status: 'TODO', sprintId: s4.id, priority: 12 },
    // Product backlog (unscheduled)
    { title: 'In-app analytics events', type: 'STORY', storyPoints: 5, status: 'TODO', priority: 13 },
    { title: 'App-store listing & screenshots', type: 'TASK', storyPoints: 3, status: 'TODO', priority: 14 },
    { title: 'Crash reporting & monitoring', type: 'BUG', storyPoints: 2, status: 'TODO', priority: 15 },
  ];
  for (const it of items) {
    await agile.createItem(
      project.id,
      backlogItemSchema.parse({ type: it.type, title: it.title, storyPoints: it.storyPoints, status: it.status, sprintId: it.sprintId, priority: it.priority, assigneeUserId: actorId }),
      actorId,
    );
  }

  // ---- Cost baseline: manpower (no WBS in agile) + platform + indirect + actuals ----
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'TECHNOLOGY_CLOUD', label: 'App backend & push infra (1 yr)', qty: 1, unitCost: 30_000_000 }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'Mobile Engineer (iOS)', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 2_200_000, planMandays: 40 }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'Mobile Engineer (Android)', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 2_200_000, planMandays: 40 }), actorId);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'Product Designer', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 1_800_000, planMandays: 20 }), actorId);
  await cost.addIndirectLine(project.id, indirectLineSchema.parse({ type: 'ACCOMMODATION', description: 'Sprint-planning offsite', amount: 8_000_000 }), actorId);

  await cost.addActualCost(project.id, actualCostSchema.parse({ date: iso(-24), amount: 60_000_000, description: 'Sprints 1–2' }), actorId);
  await cost.addActualCost(project.id, actualCostSchema.parse({ date: iso(-2), amount: 48_000_000, description: 'Sprint 3 (in progress)' }), actorId);

  return project.id;
}

// ---- EVM-trend snapshots so the "EVM Trend" tab + index history render for both
// projects. PV is the real methodology curve; EV/AC drift toward a mild CPI/SPI so
// the story reads "on track". Mirrors prisma/seed.ts:seedEvmSnapshots, scoped here. --
async function seedEvmSnapshots(projectIds: string[], createdById: string): Promise<void> {
  const day = (ms: number) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); return d; };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const projectId of projectIds) {
    const tasks = await prisma.task.findMany({ where: { projectId }, select: { planStart: true, planEnd: true } });
    // Agile projects have no WBS tasks — fall back to the charter window.
    let start: number;
    let end: number;
    if (tasks.length) {
      start = Math.min(...tasks.map((t) => +t.planStart));
      end = Math.max(...tasks.map((t) => +t.planEnd));
    } else {
      const ch = await prisma.projectCharter.findUnique({ where: { projectId }, select: { hiScheduleStart: true, hiScheduleEnd: true } });
      if (!ch?.hiScheduleStart || !ch?.hiScheduleEnd) continue;
      start = +ch.hiScheduleStart;
      end = +ch.hiScheduleEnd;
    }
    const last = Math.min(end, start + (end - start) * 0.55); // ~mid-window
    const N = 5;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const dateMs = Math.round(lerp(start, last, t));
      const statusDate = day(dateMs);
      const evm = await getProjectEvm(projectId, 0, new Date(dateMs));
      const spi = r2(lerp(1.0, 0.98, t));
      const cpi = r2(lerp(1.0, 0.96, t));
      const ev = r2(evm.pv * spi);
      const ac = cpi > 0 ? r2(ev / cpi) : ev;
      const weightedProgress = evm.bac > 0 ? Math.min(1, r2(ev / evm.bac)) : 0;
      const data = { bac: evm.bac, pv: r2(evm.pv), ev, ac, cpi, spi, weightedProgress, note: 'On track', createdById };
      await prisma.evmSnapshot.upsert({
        where: { projectId_statusDate: { projectId, statusDate } },
        create: { projectId, statusDate, ...data },
        update: data,
      });
    }
  }
}

// Entry point — plant both demo projects in the guest's personal tenant. Best-effort:
// never throws (a seed failure must not break signup/login). Idempotent-ish: only ever
// called once per guest (at first provisioning), so a simple "skip if any project exists"
// guard makes an accidental re-run a no-op.
export async function seedGuestSampleProjects(user: User, tenantId: string): Promise<void> {
  try {
    await runWithTenant(tenantId, async () => {
      const existing = await prisma.project.count();
      if (existing > 0) return; // already seeded / not empty — leave it alone
      const predictiveId = await seedPredictive(user.id);
      const agileId = await seedAgile(user.id);
      await seedEvmSnapshots([predictiveId, agileId], user.id);
    });
  } catch (err) {
    console.error('[guest-seed] failed to plant sample projects (non-fatal)', err);
  }
}
