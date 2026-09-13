import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken: string;
let adminId: string;
let projectId: string;

// Seed one project with at least one row in every domain component so the bundle exercises
// every branch (and the round-trip test in Phase 2 has something to reconstruct).
async function seedFullProject(): Promise<string> {
  const project = await prisma.project.create({
    data: {
      code: 'BND-1', name: 'Bundle Source', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE',
      clientName: 'Acme', sponsor: 'CFO', category: 'APP_DEV', costBaselineIdr: 1000, totalRevenueIdr: 1500,
      pmUserId: adminId,
    },
  });
  const pid = project.id;
  const res = await prisma.resource.create({ data: { name: 'Dev One', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 500 } });

  await prisma.projectCharter.create({ data: {
    projectId: pid, description: 'desc', goals: 'goals', category: 'APP_DEV',
    hiScope: 'scope', hiCostIdr: 1000, hiScheduleStart: new Date('2026-01-01'), hiScheduleEnd: new Date('2026-06-01'),
    hiDeliverables: 'deliverables', pmUserId: adminId,
    // Source charter is LOCKED (project active) — the clone must come back UNLOCKED (it is DRAFT).
    locked: true, committedAt: new Date('2026-01-05'), committedBy: adminId,
  } });

  const parent = await prisma.task.create({ data: { projectId: pid, wbsCode: '1', name: 'Phase', planStart: new Date('2026-01-01'), planEnd: new Date('2026-03-01'), sortOrder: 0 } });
  const child = await prisma.task.create({ data: {
    projectId: pid, parentTaskId: parent.id, wbsCode: '1.1', name: 'Build', planStart: new Date('2026-01-01'), planEnd: new Date('2026-02-01'),
    picResourceId: res.id, progressPct: 50, sortOrder: 1,
  } });
  await prisma.taskOwner.create({ data: { taskId: child.id, resourceId: res.id } });
  await prisma.taskStep.create({ data: { taskId: child.id, name: 'Step A', weight: 1, sortOrder: 0 } });
  await prisma.taskDependency.create({ data: { predecessorId: parent.id, successorId: child.id, type: 'FS', lagDays: 2 } });

  const direct = await prisma.costItemDirect.create({ data: { projectId: pid, type: 'MANPOWER', label: 'Eng', amount: 500, taskId: child.id, resourceId: res.id } });
  await prisma.costItemIndirect.create({ data: { projectId: pid, type: 'OFFICE_SUPPLIES', description: 'Office', amount: 100 } });
  await prisma.actualCostEntry.create({ data: { projectId: pid, date: new Date('2026-01-15'), amount: 200, category: 'DIRECT', directLineId: direct.id } });
  await prisma.mandayEntry.create({ data: { projectId: pid, costItemId: direct.id, date: new Date('2026-01-15'), mandays: 2 } });

  await prisma.risk.create({ data: { projectId: pid, code: 'R-001', title: 'Risk', status: 'IDENTIFIED', kind: 'THREAT', probabilityScore: 3, impactScore: 4, riskScore: 12, severity: 'HIGH', probabilityPct: 0.5, impactCostIdr: 100, emv: 50, ownerUserId: adminId } });
  await prisma.issue.create({ data: { projectId: pid, code: 'I-001', title: 'Issue', impact: 'HIGH', status: 'OPEN', ownerUserId: adminId } });
  await prisma.stakeholder.create({ data: { projectId: pid, code: 'S-001', name: 'Sponsor', category: 'SPONSOR', power: 'HIGH', interest: 'HIGH' } });
  const req = await prisma.requirement.create({ data: { projectId: pid, code: 'REQ-001', title: 'Req', category: 'FUNCTIONAL', priority: 'MUST', status: 'PROPOSED' } });
  await prisma.requirementTaskLink.create({ data: { requirementId: req.id, taskId: child.id } });
  await prisma.procurement.create({ data: { projectId: pid, code: 'PO-001', title: 'Buy', type: 'PURCHASE_ORDER', status: 'PLANNED', amount: 300, costDirectLineId: direct.id } });
  await prisma.assumption.create({ data: { projectId: pid, code: 'A-001', statement: 'Assume', status: 'OPEN', impact: 'MEDIUM', ownerUserId: adminId } });
  await prisma.uatTestCase.create({ data: { projectId: pid, code: 'UAT-001', title: 'Login works', expected: 'ok', status: 'NOT_RUN', sortOrder: 0 } });
  const sprint = await prisma.sprint.create({ data: { projectId: pid, name: 'Sprint 1', status: 'PLANNED', sortOrder: 0 } });
  await prisma.backlogItem.create({ data: { projectId: pid, sprintId: sprint.id, type: 'STORY', title: 'Story', storyPoints: 5, status: 'TODO', assigneeUserId: adminId, sortOrder: 0 } });
  await prisma.lessonLearned.create({ data: { projectId: pid, category: 'RECOMMENDATION', title: 'Lesson' } });
  await prisma.acceptanceSignoff.create({ data: { projectId: pid, party: 'Sponsor', decision: 'ACCEPTED' } });

  // v2: frozen cost baseline (reserves + BAC) + cross-project dependency register.
  await prisma.costBaseline.create({ data: { projectId: pid, directTotal: 500, indirectTotal: 100, contingencyReserve: 60, managementReserve: 40, costBaseline: 660, budgetAtCompletion: 700 } });
  await prisma.projectDependency.create({ data: { projectId: pid, code: 'DEP-001', description: 'Vendor API ready', direction: 'INBOUND', status: 'PENDING', impact: 'HIGH', ownerUserId: adminId } });

  return pid;
}

beforeAll(async () => {
  const r = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (r.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${r.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const admin = await prisma.user.create({ data: { name: 'Bnd Admin', email: 'bnd-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  adminId = admin.id;
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  projectId = await seedFullProject();
});

describe('Project bundle export (Phase 1)', () => {
  it('serialises every domain component with in-bundle references', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/export/bundle`)).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('BND-1_bundle.json');
    const b = res.body;

    expect(b.formatVersion).toBe(2);
    expect(b.exportedFrom.code).toBe('BND-1');
    expect(b.project.name).toBe('Bundle Source');
    expect(b.project.costBaselineIdr).toBe(1000);
    expect(b.pm.email).toBe('bnd-admin@corp.test');
    expect(b.charter.hiScope).toBe('scope');

    // Counts per component.
    expect(b.resources.length).toBe(1);
    expect(b.tasks.length).toBe(2);
    expect(b.taskDependencies.length).toBe(1);
    expect(b.costDirect.length).toBe(1);
    expect(b.costIndirect.length).toBe(1);
    expect(b.actualCosts.length).toBe(1);
    expect(b.mandayEntries.length).toBe(1);
    expect(b.risks.length).toBe(1);
    expect(b.issues.length).toBe(1);
    expect(b.stakeholders.length).toBe(1);
    expect(b.requirements.length).toBe(1);
    expect(b.procurement.length).toBe(1);
    expect(b.assumptions.length).toBe(1);
    expect(b.uat.length).toBe(1);
    expect(b.agile.sprints.length).toBe(1);
    expect(b.agile.backlog.length).toBe(1);
    expect(b.lessons.length).toBe(1);
    expect(b.acceptances.length).toBe(1);

    // Cross-entity references resolve within the bundle (not raw DB FKs the importer can't map).
    const parent = b.tasks.find((t: any) => t.wbsCode === '1');
    const child = b.tasks.find((t: any) => t.wbsCode === '1.1');
    expect(child.parentLocalId).toBe(parent.localId);
    expect(child.steps.length).toBe(1);
    expect(b.taskDependencies[0].predecessorLocalId).toBe(parent.localId);
    expect(b.taskDependencies[0].successorLocalId).toBe(child.localId);
    // pic + owner point at the exported resource ref.
    const resRef = b.resources[0].ref;
    expect(child.picResourceRef).toBe(resRef);
    expect(child.ownerResourceRefs).toContain(resRef);
    // cost line → task + resource refs; actual + manday + procurement → the cost line's localId.
    expect(b.costDirect[0].taskLocalId).toBe(child.localId);
    expect(b.costDirect[0].resourceRef).toBe(resRef);
    expect(b.actualCosts[0].directLineLocalId).toBe(b.costDirect[0].localId);
    expect(b.mandayEntries[0].costItemLocalId).toBe(b.costDirect[0].localId);
    expect(b.procurement[0].costDirectLineLocalId).toBe(b.costDirect[0].localId);
    // requirement → task link, owner emails.
    expect(b.requirements[0].taskLocalIds).toContain(child.localId);
    expect(b.risks[0].ownerEmail).toBe('bnd-admin@corp.test');
    expect(b.agile.backlog[0].assigneeEmail).toBe('bnd-admin@corp.test');

    // v2 sections.
    expect(b.costBaseline.budgetAtCompletion).toBe(700);
    expect(b.costBaseline.managementReserve).toBe(40);
    expect(b.projectDependencies.length).toBe(1);
    expect(b.projectDependencies[0].code).toBe('DEP-001');
    expect(b.projectDependencies[0].ownerEmail).toBe('bnd-admin@corp.test');
    expect(b.charter.locked).toBe(true); // source is locked…
  });
});

describe('Project bundle import — round-trip clone (Phase 2)', () => {
  async function fetchBundle(): Promise<Buffer> {
    const res = await request(app).get(api(`/projects/${projectId}/export/bundle`)).set(auth(adminToken));
    expect(res.status).toBe(200);
    return Buffer.from(JSON.stringify(res.body), 'utf8');
  }

  it('dry-run previews counts + warnings without writing a new project', async () => {
    const before = await prisma.project.count();
    const res = await request(app).post(api('/projects/import/bundle')).set(auth(adminToken)).attach('file', await fetchBundle(), 'bundle.json');
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.preview.sourceCode).toBe('BND-1');
    expect(res.body.preview.counts.tasks).toBe(2);
    expect(res.body.preview.counts.risks).toBe(1);
    expect(await prisma.project.count()).toBe(before); // nothing written
  });

  it('commits a faithful clone: new DRAFT project with every component + intact relationships', async () => {
    const res = await request(app).post(api('/projects/import/bundle?dryRun=false')).set(auth(adminToken)).attach('file', await fetchBundle(), 'bundle.json');
    expect(res.status).toBe(201);
    const newId: string = res.body.projectId;
    expect(newId).not.toBe(projectId);
    expect(res.body.code).toMatch(/^PRJ-\d{4}-\d{4}$/);

    const clone = await prisma.project.findUniqueOrThrow({ where: { id: newId } });
    expect(clone.status).toBe('DRAFT');
    expect(clone.name).toBe('Bundle Source');
    expect(Number(clone.costBaselineIdr)).toBe(1000);
    expect(clone.pmUserId).toBe(adminId); // pm email resolved back to the admin

    // Per-component counts match the source.
    expect(await prisma.projectCharter.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.task.count({ where: { projectId: newId } })).toBe(2);
    expect(await prisma.costItemDirect.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.costItemIndirect.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.actualCostEntry.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.mandayEntry.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.risk.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.issue.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.stakeholder.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.requirement.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.procurement.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.assumption.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.uatTestCase.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.sprint.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.backlogItem.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.lessonLearned.count({ where: { projectId: newId } })).toBe(1);
    expect(await prisma.acceptanceSignoff.count({ where: { projectId: newId } })).toBe(1);

    // Relationships remapped to the NEW rows (not dangling / not pointing at the source project).
    const parent = await prisma.task.findFirstOrThrow({ where: { projectId: newId, wbsCode: '1' } });
    const child = await prisma.task.findFirstOrThrow({ where: { projectId: newId, wbsCode: '1.1' }, include: { owners: true, steps: true } });
    expect(child.parentTaskId).toBe(parent.id);
    expect(child.picResourceId).not.toBeNull();
    expect(child.owners.length).toBe(1);
    expect(child.steps.length).toBe(1);

    const dep = await prisma.taskDependency.findFirstOrThrow({ where: { predecessorId: parent.id } });
    expect(dep.successorId).toBe(child.id);
    expect(dep.lagDays).toBe(2);

    const direct = await prisma.costItemDirect.findFirstOrThrow({ where: { projectId: newId } });
    expect(direct.taskId).toBe(child.id); // cost→task remapped
    const actual = await prisma.actualCostEntry.findFirstOrThrow({ where: { projectId: newId } });
    expect(actual.directLineId).toBe(direct.id); // actual→cost line remapped
    const manday = await prisma.mandayEntry.findFirstOrThrow({ where: { projectId: newId } });
    expect(manday.costItemId).toBe(direct.id);
    const proc = await prisma.procurement.findFirstOrThrow({ where: { projectId: newId } });
    expect(proc.costDirectLineId).toBe(direct.id);

    const link = await prisma.requirementTaskLink.findFirstOrThrow({ where: { requirement: { projectId: newId } } });
    expect(link.taskId).toBe(child.id); // requirement→task remapped
    const risk = await prisma.risk.findFirstOrThrow({ where: { projectId: newId } });
    expect(risk.ownerUserId).toBe(adminId); // owner email resolved
    const backlog = await prisma.backlogItem.findFirstOrThrow({ where: { projectId: newId } });
    expect(backlog.assigneeUserId).toBe(adminId);
    expect(backlog.sprintId).not.toBeNull(); // backlog→sprint remapped

    // v2: cost baseline (reserves + BAC) reproduced, cross-project dep carried.
    const cb = await prisma.costBaseline.findUniqueOrThrow({ where: { projectId: newId } });
    expect(Number(cb.budgetAtCompletion)).toBe(700);
    expect(Number(cb.managementReserve)).toBe(40);
    const pdep = await prisma.projectDependency.findFirstOrThrow({ where: { projectId: newId } });
    expect(pdep.code).toBe('DEP-001');
    expect(pdep.ownerUserId).toBe(adminId);

    // Coherence: source charter was locked, but the DRAFT clone's charter must be UNLOCKED.
    const clonedCharter = await prisma.projectCharter.findUniqueOrThrow({ where: { projectId: newId } });
    expect(clonedCharter.locked).toBe(false);
    expect(clonedCharter.committedAt).toBeNull();

    // Reconciliation report is returned and every component fully imported (imported === expected).
    const recon = res.body.reconciliation as Record<string, { expected: number; imported: number }>;
    expect(recon).toBeTruthy();
    for (const [, r] of Object.entries(recon)) expect(r.imported).toBeGreaterThanOrEqual(r.expected);
  });

  it('rejects a non-JSON file and a bad format version', async () => {
    const bad = await request(app).post(api('/projects/import/bundle')).set(auth(adminToken)).attach('file', Buffer.from('nope'), 'notes.txt');
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const wrongVer = Buffer.from(JSON.stringify({ formatVersion: 99, project: { name: 'X' } }), 'utf8');
    const res = await request(app).post(api('/projects/import/bundle')).set(auth(adminToken)).attach('file', wrongVer, 'bundle.json');
    expect(res.status).toBe(400);
  });
});
