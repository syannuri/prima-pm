/* eslint-disable no-console */
// =====================================================================
// PRIMA-PM seed — creates demo users (per role), rate cards, and ONE fully
// populated demo project that exercises every module through the real
// service layer (charter commit -> cost -> risk -> schedule -> EVM).
// Run: npm run db:seed  (after `prisma migrate dev`)
// =====================================================================
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';

import * as projects from '../src/modules/projects/projects.service.js';
import * as charter from '../src/modules/charter/charter.service.js';
import * as cost from '../src/modules/cost/cost.service.js';
import * as risk from '../src/modules/risk/risk.service.js';
import * as schedule from '../src/modules/schedule/schedule.service.js';
import { getProjectEvm } from '../src/modules/agile/agile.service.js';

import { upsertCharterSchema } from '../src/modules/charter/charter.schemas.js';
import { directLineSchema, indirectLineSchema, actualCostSchema } from '../src/modules/cost/cost.schemas.js';
import { upsertRiskSchema } from '../src/modules/risk/risk.schemas.js';
import { upsertTaskSchema } from '../src/modules/schedule/schedule.schemas.js';

async function seedUsers() {
  // Dev-only seed accounts. Password is configurable via SEED_PASSWORD so nothing weak is
  // baked into the repo; emails use the reserved example.com domain so they're never mistaken
  // for (or tried against) a real deployment. These exist only in a seeded dev/CI database.
  const rawPassword = process.env.SEED_PASSWORD ?? 'DevSeed-2026!';
  const password = await hashPassword(rawPassword);
  const defs: Array<{ name: string; email: string; role: any }> = [
    { name: 'Alice Admin', email: 'admin@example.com', role: 'ADMIN' },
    { name: 'Pita PMO', email: 'pmo@example.com', role: 'PMO' },
    { name: 'Budi Project Manager', email: 'pm@example.com', role: 'PROJECT_MANAGER' },
    { name: 'Fani Finance', email: 'finance@example.com', role: 'FINANCE' },
    { name: 'Rudi Risk Officer', email: 'risk@example.com', role: 'RISK_OFFICER' },
    { name: 'Andi Team Member', email: 'pic@example.com', role: 'TEAM_MEMBER' },
    { name: 'Vera Viewer', email: 'viewer@example.com', role: 'VIEWER' },
  ];
  const users: Record<string, { id: string }> = {};
  for (const d of defs) {
    const u = await prisma.user.upsert({
      where: { email: d.email },
      create: { name: d.name, email: d.email, role: d.role, passwordHash: password },
      update: { name: d.name, role: d.role },
    });
    users[d.role] = u;
  }
  console.log(`  ✓ ${defs.length} users (password: "${rawPassword}" — override with SEED_PASSWORD)`);
  return users;
}

async function seedRateCards() {
  const cards = [
    { roleName: 'Project Manager', level: 'Senior', unitCostPerManday: 2_500_000 },
    { roleName: 'Solution Architect', level: 'Senior', unitCostPerManday: 3_000_000 },
    { roleName: 'Engineer', level: 'Mid', unitCostPerManday: 1_500_000 },
    { roleName: 'Engineer', level: 'Junior', unitCostPerManday: 900_000 },
    { roleName: 'Security Analyst', level: 'Senior', unitCostPerManday: 2_800_000 },
  ];
  for (const c of cards) {
    // (roleName, level) is unique per owner scope (corporate = personalOwnerId NULL) at the app
    // layer now — there's no compound DB key to upsert on, so find-or-update by hand.
    const existing = await prisma.rateCard.findFirst({ where: { roleName: c.roleName, level: c.level, personalOwnerId: null } });
    if (existing) await prisma.rateCard.update({ where: { id: existing.id }, data: { unitCostPerManday: c.unitCostPerManday } });
    else await prisma.rateCard.create({ data: c });
  }
  console.log(`  ✓ ${cards.length} rate cards`);
}

// A small NAMED resource pool so the Cost-tab manpower picker + capacity view have
// real people to assign (and so the e2e resource-picker specs have "Budi Santoso").
async function seedResources() {
  const pool = [
    { name: 'Budi Santoso', personnelRole: 'PROJECT_PERSONNEL' as const, unitCostPerManday: 3_000_000, roleTitle: 'Solution Architect' },
    { name: 'Sari Dewi', personnelRole: 'PM' as const, unitCostPerManday: 2_500_000, roleTitle: 'Project Manager' },
    { name: 'Andi Nugroho', personnelRole: 'PROJECT_PERSONNEL' as const, unitCostPerManday: 1_500_000, roleTitle: 'Engineer' },
  ];
  await prisma.resource.deleteMany({ where: { name: { in: pool.map((r) => r.name) } } });
  await prisma.resource.createMany({ data: pool });
  console.log(`  ✓ ${pool.length} named resources (pool)`);
}

const DEMO_NAMES = ['SOC Modernization Program', 'Cloud Migration Wave 1'];

async function resetDemoProject() {
  // Remove any prior demo projects (cascade clears charter/cost/risk/schedule).
  await prisma.project.deleteMany({ where: { name: { in: DEMO_NAMES } } });
}

// A second, lighter project so the portfolio dashboard shows aggregation.
async function seedSecondProject(users: Record<string, { id: string }>) {
  const admin = users.ADMIN.id;
  const pm = users.PROJECT_MANAGER.id;
  const pic = users.TEAM_MEMBER.id;
  const riskOfficer = users.RISK_OFFICER.id;

  const project = await projects.createProject(
    { name: 'Cloud Migration Wave 1', sponsor: 'CTO Office', pmUserId: pm },
    admin,
  );
  await charter.upsertCharter(
    project.id,
    upsertCharterSchema.parse({
      description: 'Migrate 30 on-prem workloads to the public cloud with IaC and observability.',
      goals: 'Cut infra opex by 25% and improve scalability.',
      category: 'CLOUD_INFRA',
      hiScope: 'Landing zone, 30 workload migrations, monitoring, runbooks.',
      hiCostIdr: 800_000_000,
      hiScheduleStart: '2026-08-01',
      hiScheduleEnd: '2026-11-30',
      hiDeliverables: 'Workloads live in cloud, IaC pipelines, dashboards.',
      pmUserId: pm,
    }),
    pm,
  );
  await charter.commitCharter(project.id, pm);

  const t1 = await schedule.createTask(project.id, upsertTaskSchema.parse({ name: 'Landing zone setup', planStart: '2026-08-01', planEnd: '2026-08-31', picUserId: pic, progressPct: 90, actualStart: '2026-08-01', sortOrder: 1 }), pm);
  const t2 = await schedule.createTask(project.id, upsertTaskSchema.parse({ name: 'Workload migration', planStart: '2026-09-01', planEnd: '2026-11-15', picUserId: pic, progressPct: 40, actualStart: '2026-09-02', sortOrder: 2 }), pm);

  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'TECHNOLOGY_CLOUD', label: 'Cloud platform (1 yr)', qty: 1, unitCost: 300_000_000 }), pm);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'Cloud Engineer', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 2_000_000, planMandays: 30, taskId: t1.id }), pm);
  await cost.addDirectLine(project.id, directLineSchema.parse({ type: 'MANPOWER', label: 'Migration Lead', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 2_500_000, planMandays: 50, taskId: t2.id }), pm);
  await cost.addIndirectLine(project.id, indirectLineSchema.parse({ type: 'TRANSPORTATION', description: 'DC decommission visits', amount: 8_000_000 }), pm);

  await risk.createRisk(project.id, upsertRiskSchema.parse({ title: 'Data egress cost overrun', kind: 'THREAT', probabilityScore: 3, impactScore: 4, probabilityPct: 0.35, impactCostIdr: 90_000_000, responseStrategy: 'MITIGATE', residualProbabilityPct: 0.15, residualImpactCost: 90_000_000 }), riskOfficer);
  await cost.addActualCost(project.id, actualCostSchema.parse({ date: '2026-09-10', amount: 150_000_000, description: 'Cloud setup & first migrations' }), pm);
  console.log(`  ✓ second project ${project.code}`);
}

async function seedDemoProject(users: Record<string, { id: string }>) {
  const admin = users.ADMIN.id;
  const pm = users.PROJECT_MANAGER.id;
  const pic = users.TEAM_MEMBER.id;
  const riskOfficer = users.RISK_OFFICER.id;

  // 1) Project
  const project = await projects.createProject(
    { name: 'SOC Modernization Program', sponsor: 'CISO Office', pmUserId: pm },
    admin,
  );
  console.log(`  ✓ project ${project.code}`);

  // 2) Charter + Commit
  const charterInput = upsertCharterSchema.parse({
    description: 'Modernize the Security Operations Center with SIEM + SOAR and 24/7 monitoring.',
    goals: 'Reduce MTTR by 40%, achieve full log coverage, and automate tier-1 response.',
    category: 'CYBERSECURITY_INFRA',
    hiScope: 'SIEM platform, SOAR playbooks, log onboarding for 50 sources, SOC runbooks & training.',
    hiCostIdr: 1_500_000_000,
    hiScheduleStart: '2026-07-01',
    hiScheduleEnd: '2026-12-19',
    hiDeliverables: 'Operational SOC, automated playbooks, trained analysts, monitoring dashboards.',
    pmUserId: pm,
  });
  await charter.upsertCharter(project.id, charterInput, pm);
  await charter.commitCharter(project.id, pm);
  console.log('  ✓ charter committed (project -> CHARTERED)');

  // 3) Schedule (parent phases + subtasks)
  const phase1 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Phase 1 — Design & Procurement', planStart: '2026-07-01', planEnd: '2026-08-15', sortOrder: 1 }),
    pm,
  );
  const t11 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Architecture design', parentTaskId: phase1.id, planStart: '2026-07-01', planEnd: '2026-07-20', picUserId: pic, progressPct: 100, actualStart: '2026-07-01', actualFinish: '2026-07-21', sortOrder: 1 }),
    pm,
  );
  const t12 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'SIEM/SOAR procurement', parentTaskId: phase1.id, planStart: '2026-07-21', planEnd: '2026-08-15', picUserId: pic, progressPct: 60, actualStart: '2026-07-22', sortOrder: 2 }),
    pm,
  );
  const phase2 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Phase 2 — Implementation', planStart: '2026-08-16', planEnd: '2026-11-30', sortOrder: 2 }),
    pm,
  );
  const t21 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'Log source onboarding', parentTaskId: phase2.id, planStart: '2026-08-16', planEnd: '2026-10-15', picUserId: pic, progressPct: 20, actualStart: '2026-08-18', sortOrder: 1 }),
    pm,
  );
  const t22 = await schedule.createTask(
    project.id,
    upsertTaskSchema.parse({ name: 'SOAR playbook automation', parentTaskId: phase2.id, planStart: '2026-10-16', planEnd: '2026-11-30', picUserId: pic, progressPct: 0, sortOrder: 2 }),
    pm,
  );

  // Dependency: procurement (t12) -> onboarding (t21)
  await schedule.addDependency(project.id, t21.id, { predecessorId: t12.id, type: 'FS', lagDays: 0 }, pm);
  console.log('  ✓ 6 tasks + 1 dependency');

  // 4) Cost — Direct (material + manpower linked to tasks) and Indirect
  const directMaterials = [
    directLineSchema.parse({ type: 'TECHNOLOGY_CLOUD', label: 'SIEM cloud subscription (1 yr)', qty: 1, unitCost: 400_000_000 }),
    directLineSchema.parse({ type: 'SOFTWARE_LICENSE', label: 'SOAR platform license', qty: 1, unitCost: 250_000_000 }),
    directLineSchema.parse({ type: 'HARDWARE_LICENSE', label: 'Log collector appliances', qty: 4, unitCost: 35_000_000 }),
  ];
  for (const m of directMaterials) await cost.addDirectLine(project.id, m, pm);

  const manpower = [
    { line: { type: 'MANPOWER', label: 'Solution Architect', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 3_000_000, planMandays: 20, taskId: t11.id }, who: t11 },
    { line: { type: 'MANPOWER', label: 'Project Manager', personnelRole: 'PM', unitCostPerManday: 2_500_000, planMandays: 25, taskId: t12.id }, who: t12 },
    { line: { type: 'MANPOWER', label: 'Engineer (onboarding)', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 1_500_000, planMandays: 40, taskId: t21.id }, who: t21 },
    { line: { type: 'MANPOWER', label: 'Security Analyst (playbooks)', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 2_800_000, planMandays: 30, taskId: t22.id }, who: t22 },
  ];
  for (const m of manpower) await cost.addDirectLine(project.id, directLineSchema.parse(m.line), pm);

  const indirects = [
    indirectLineSchema.parse({ type: 'TRANSPORTATION', description: 'Site visits to data centers', amount: 15_000_000 }),
    indirectLineSchema.parse({ type: 'ACCOMMODATION', description: 'On-site implementation lodging', amount: 25_000_000 }),
    indirectLineSchema.parse({ type: 'ENTERTAINMENT', description: 'Vendor & stakeholder meetings', amount: 10_000_000 }),
  ];
  for (const i of indirects) await cost.addIndirectLine(project.id, i, pm);
  console.log('  ✓ 7 direct + 3 indirect cost lines');

  // 5) Risk register (drives Contingency Reserve -> recomputes baseline)
  const risks = [
    upsertRiskSchema.parse({ title: 'Log source integration delays', kind: 'THREAT', probabilityScore: 4, impactScore: 4, probabilityPct: 0.4, impactCostIdr: 120_000_000, responseStrategy: 'MITIGATE', residualProbabilityPct: 0.2, residualImpactCost: 120_000_000 }),
    upsertRiskSchema.parse({ title: 'Vendor SLA breach on SOAR', kind: 'THREAT', probabilityScore: 3, impactScore: 5, probabilityPct: 0.25, impactCostIdr: 200_000_000, responseStrategy: 'TRANSFER' }),
    upsertRiskSchema.parse({ title: 'Key analyst attrition', kind: 'THREAT', probabilityScore: 3, impactScore: 3, probabilityPct: 0.3, impactCostIdr: 80_000_000, responseStrategy: 'ACCEPT' }),
    upsertRiskSchema.parse({ title: 'Early vendor discount opportunity', kind: 'OPPORTUNITY', probabilityScore: 2, impactScore: 2, probabilityPct: 0.5, impactCostIdr: 50_000_000, responseStrategy: 'EXPLOIT' }),
  ];
  for (const r of risks) await risk.createRisk(project.id, r, riskOfficer);
  console.log('  ✓ 4 risks (3 threats + 1 opportunity)');

  // Time-phased actual cost (feeds CPI)
  await cost.addActualCost(project.id, actualCostSchema.parse({ date: '2026-08-15', amount: 120_000_000, description: 'Phase 1 design & licenses' }), pm);
  await cost.addActualCost(project.id, actualCostSchema.parse({ date: '2026-09-20', amount: 160_000_000, description: 'Procurement & onboarding' }), pm);
  console.log('  ✓ 2 actual cost entries');

  // 6) Show resulting baseline + EVM
  const summary = await cost.getCostSummary(project.id);
  const evm = await schedule.getEvm(project.id, 250_000_000, new Date('2026-09-01'));
  console.log('  ── Baseline:', JSON.stringify({
    direct: summary.baseline?.directTotal,
    indirect: summary.baseline?.indirectTotal,
    contingency: summary.baseline?.contingencyReserve,
    BAC: summary.baseline?.budgetAtCompletion,
  }));
  console.log('  ── EVM @2026-09-01:', JSON.stringify({ PV: evm.pv, EV: evm.ev, AC: evm.ac, CPI: evm.cpi, SPI: evm.spi, health: evm.health }));

  return project;
}

// EVM-trend snapshots so the "EVM Trend" tab is populated in a fresh demo. PV is the
// REAL methodology PV curve (getProjectEvm per date); EV/AC are synthesized to drift
// toward a mild per-project CPI/SPI so the S-curve + index trend tell a story. Idempotent.
async function seedEvmSnapshots(users: Record<string, { id: string }>) {
  const day = (ms: number) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); return d; };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // name → target indices (default = mild). "Cloud Migration Wave 1" runs a cost overrun.
  const TARGET: Record<string, { cpi: number; spi: number; note: string }> = {
    'Cloud Migration Wave 1': { cpi: 0.89, spi: 0.93, note: 'Cost overrun' },
  };
  const projs = await prisma.project.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
  let total = 0;
  for (const proj of projs) {
    const tasks = await prisma.task.findMany({ where: { projectId: proj.id }, select: { planStart: true, planEnd: true } });
    if (!tasks.length) continue;
    const start = Math.min(...tasks.map((t) => +t.planStart));
    const end = Math.max(...tasks.map((t) => +t.planEnd));
    const last = Math.min(end, start + (end - start) * 0.55); // ~mid-window, like the tuned demo
    const cfg = TARGET[proj.name] ?? { cpi: 1.02, spi: 1.01, note: 'On track' };
    const N = 5;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const dateMs = Math.round(lerp(start, last, t));
      const statusDate = day(dateMs);
      const evm = await getProjectEvm(proj.id, 0, new Date(dateMs));
      const spi = r2(lerp(1.0, cfg.spi, t));
      const cpi = r2(lerp(1.0, cfg.cpi, t));
      const ev = r2(evm.pv * spi);
      const ac = cpi > 0 ? r2(ev / cpi) : ev;
      const weightedProgress = evm.bac > 0 ? Math.min(1, r2(ev / evm.bac)) : 0;
      const data = { bac: evm.bac, pv: r2(evm.pv), ev, ac, cpi, spi, weightedProgress, note: cfg.note, createdById: users.PMO?.id ?? null };
      await prisma.evmSnapshot.upsert({
        where: { projectId_statusDate: { projectId: proj.id, statusDate } },
        create: { projectId: proj.id, statusDate, ...data },
        update: data,
      });
      total++;
    }
  }
  console.log(`  ✓ ${total} EVM-trend snapshots`);
}

async function main() {
  console.log('🌱 Seeding PRIMA-PM...');
  const users = await seedUsers();
  await seedRateCards();
  await seedResources();
  await resetDemoProject();
  await seedDemoProject(users);
  await seedSecondProject(users);
  await seedEvmSnapshots(users);
  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
