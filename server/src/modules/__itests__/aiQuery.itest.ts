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
import { validateSpec, runQuery } from '../assistant/query.service.js';

// Anett natural-language data query (query_data tool). Exercises the whitelist validation, the
// deterministic engine (filter/sort/limit over derived columns), access scoping, and the tool path
// that surfaces a `tables` payload to the client.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const answerPort: AiPort = { async draftJson() { return null; }, async draftNarrative() { return null; }, async runToolLoop() { return 'ok'; } };
const scriptPort = (fn: (ex: (n: string, i: unknown) => Promise<string>) => Promise<unknown>): AiPort => ({
  async draftJson() { return null; }, async draftNarrative() { return null; },
  async runToolLoop({ executeTool }) { return JSON.stringify(await fn(executeTool)); },
});

let prevFlag: string | undefined;
let prevKey: string | undefined;
let pmToken = '';
let tid = '';
let pmId = '';

const past = new Date(Date.now() - 7 * 864e5);
const future = new Date(Date.now() + 7 * 864e5);
const ask = (token: string) => request(app).post(api('/assistant/ask')).set(bearer(token)).send({ messages: [{ role: 'user', content: 'x' }] });

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true'; process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(answerPort);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'qco', name: 'Q Co', aiNarrativeEnabled: true } });
  tid = t.id;
  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@qco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  pmId = pm.id;
  await prisma.membership.create({ data: { userId: pm.id, tenantId: tid, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid });
  const other = await prisma.user.create({ data: { name: 'other', email: 'other@qco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: other.id, tenantId: tid, role: 'PROJECT_MANAGER' } });

  await runWithTenant(tid, async () => {
    const mine1 = await prisma.project.create({ data: { code: 'MINE-1', name: 'Behind & CR', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
    const mine2 = await prisma.project.create({ data: { code: 'MINE-2', name: 'Healthy', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
    await prisma.project.create({ data: { code: 'OTHER-1', name: 'Foreign', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: other.id } });
    // Latest EVM snapshots: MINE-1 behind (SPI 0.8), MINE-2 healthy (SPI 1.0).
    await prisma.evmSnapshot.create({ data: { projectId: mine1.id, statusDate: past, bac: 1000, pv: 500, ev: 400, ac: 360, spi: 0.8, cpi: 1.11, weightedProgress: 0.4 } });
    await prisma.evmSnapshot.create({ data: { projectId: mine2.id, statusDate: past, bac: 800, pv: 400, ev: 400, ac: 400, spi: 1.0, cpi: 1.0, weightedProgress: 0.5 } });
    // MINE-1: one overdue task + one pending CR.
    const t1 = await prisma.task.create({ data: { projectId: mine1.id, wbsCode: '1.1', name: 'Late task', planStart: past, planEnd: past, progressPct: 50 } });
    await prisma.task.create({ data: { projectId: mine2.id, wbsCode: '1.1', name: 'On track', planStart: past, planEnd: future, progressPct: 20 } });
    await prisma.changeRequest.create({ data: { projectId: mine1.id, type: 'SCOPE', title: 'Add scope', description: 'More work', requestedBy: pm.id, status: 'SUBMITTED' } });
    // MINE-1 cost structure: one direct (material) line partly spent, one indirect line.
    const dLine = await prisma.costItemDirect.create({ data: { projectId: mine1.id, type: 'SOFTWARE_LICENSE', label: 'CI Tool', qty: 1, unitCost: 300, amount: 300, sortOrder: 0 } });
    await prisma.costItemIndirect.create({ data: { projectId: mine1.id, type: 'TRANSPORTATION', description: 'Site travel', amount: 100 } });
    await prisma.actualCostEntry.create({ data: { projectId: mine1.id, date: past, amount: 120, category: 'DIRECT', directLineId: dLine.id, description: 'partial spend' } });
    // MINE-1 schedule network: a second (on-track) task + a FS dependency → a CPM network with a critical path.
    const t2 = await prisma.task.create({ data: { projectId: mine1.id, wbsCode: '1.2', name: 'Build', planStart: past, planEnd: future, progressPct: 10 } });
    await prisma.taskDependency.create({ data: { predecessorId: t1.id, successorId: t2.id, type: 'FS' } });
    // MINE-1 RAID registers (assumption / issue / cross-team dependency) + a requirement traced to a task.
    await prisma.issue.create({ data: { projectId: mine1.id, code: 'ISS-001', title: 'Vendor delay', impact: 'HIGH', status: 'OPEN' } });
    await prisma.assumption.create({ data: { projectId: mine1.id, code: 'ASM-001', statement: 'Test env ready by May', status: 'OPEN', impact: 'MEDIUM' } });
    await prisma.projectDependency.create({ data: { projectId: mine1.id, code: 'DEP-001', description: 'API from platform team', direction: 'INBOUND', counterparty: 'Platform', status: 'PENDING', impact: 'HIGH' } });
    const req = await prisma.requirement.create({ data: { projectId: mine1.id, code: 'REQ-001', title: 'Single sign-on', category: 'FUNCTIONAL', priority: 'MUST', status: 'APPROVED' } });
    await prisma.requirementTaskLink.create({ data: { requirementId: req.id, taskId: t2.id } });
  });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('Anett data query — query_data', () => {
  it('validateSpec rejects unknown entity / field / operator', () => {
    expect(() => validateSpec({ entity: 'aliens' as never })).toThrow();
    expect(() => validateSpec({ entity: 'projects', filters: [{ field: 'nope', op: 'eq', value: 1 }] })).toThrow();
    expect(() => validateSpec({ entity: 'projects', filters: [{ field: 'name', op: 'gt', value: 'x' }] })).toThrow(); // gt not valid on string
  });

  it('projects: filter (spi<0.9) is scoped to the caller and returns only matching rows', async () => {
    const table = await runWithTenant(tid, () => runQuery({ entity: 'projects', filters: [{ field: 'spi', op: 'lt', value: 0.9 }], sort: { field: 'spi', dir: 'asc' } }, pmId, 'PROJECT_MANAGER'));
    const codes = table.rows.map((r) => r.code);
    expect(codes).toEqual(['MINE-1']);        // MINE-2 (spi 1.0) excluded; OTHER-1 not accessible
    expect(table.total).toBe(1);
    expect(table.columns.some((c) => c.key === 'spi')).toBe(true);
  });

  it('projects: compound filter (pendingCRs>0) + derived aggregates', async () => {
    const table = await runWithTenant(tid, () => runQuery({ entity: 'projects', filters: [{ field: 'pendingCRs', op: 'gt', value: 0 }], columns: ['code', 'pendingCRs', 'overdueTasks'] }, pmId, 'PROJECT_MANAGER'));
    expect(table.rows.length).toBe(1);
    expect(table.rows[0]).toMatchObject({ code: 'MINE-1', pendingCRs: 1, overdueTasks: 1 });
  });

  it('projects: server-computed money `sums` over all matching rows (so the model never hand-sums rupiah)', async () => {
    const table = await runWithTenant(tid, () => runQuery({ entity: 'projects', columns: ['code', 'ev', 'ac'] }, pmId, 'PROJECT_MANAGER'));
    // MINE-1 (ev 400, ac 360) + MINE-2 (ev 400, ac 400); OTHER-1 not accessible.
    expect(table.sums).toMatchObject({ ev: 800, ac: 760 });
  });

  it('tasks: filter overdue=true across accessible projects', async () => {
    const table = await runWithTenant(tid, () => runQuery({ entity: 'tasks', filters: [{ field: 'overdue', op: 'eq', value: true }] }, pmId, 'PROJECT_MANAGER'));
    expect(table.rows.map((r) => r.name)).toEqual(['Late task']);
    expect(table.rows[0].project).toBe('MINE-1');
  });

  it('list_projects returns code + name (not just codes) so a named project can map to a code', async () => {
    __setAiPort(scriptPort(async (ex) => JSON.parse(await ex('list_projects', {}))));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    const out = JSON.parse(res.body.answer) as { count: number; projects: { code: string; name: string }[] };
    expect(out.projects.map((p) => p.code).sort()).toEqual(['MINE-1', 'MINE-2']); // OTHER-1 not accessible
    const nameByCode = Object.fromEntries(out.projects.map((p) => [p.code, p.name]));
    expect(nameByCode['MINE-2']).toBe('Healthy');
  });

  it('get_project_details resolves a project by NAME and by a partial word — not only by code', async () => {
    __setAiPort(scriptPort(async (ex) => ({
      byCode: JSON.parse(await ex('get_project_details', { project_code: 'mine-2' })),   // case-insensitive code
      byName: JSON.parse(await ex('get_project_details', { project_code: 'Healthy' })),  // exact name → MINE-2
      byPartial: JSON.parse(await ex('get_project_details', { project_code: 'behind' })), // word from "Behind & CR" → MINE-1
      unknown: JSON.parse(await ex('get_project_details', { project_code: 'no such project' })),
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    const out = JSON.parse(res.body.answer) as {
      byCode: { project?: { code: string } }; byName: { project?: { code: string } };
      byPartial: { project?: { code: string } }; unknown: { error?: string };
    };
    expect(out.byCode.project?.code).toBe('MINE-2');
    expect(out.byName.project?.code).toBe('MINE-2');
    expect(out.byPartial.project?.code).toBe('MINE-1');
    expect(out.unknown.error).toBeTruthy(); // unresolvable ref → friendly error, no leak
  });

  it('get_project_costs returns per-line budget/actual/remaining; an inaccessible project → friendly error, no leak', async () => {
    __setAiPort(scriptPort(async (ex) => ({
      mine: JSON.parse(await ex('get_project_costs', { project_code: 'MINE-1' })),
      unknown: JSON.parse(await ex('get_project_costs', { project_code: 'OTHER-1' })), // real code, not accessible
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    const out = JSON.parse(res.body.answer) as {
      mine: { direct: { label: string; budget: number; actualToDate: number; remaining: number }[]; indirect: { description: string }[]; summary: { directActual: number } };
      unknown: { error?: string };
    };
    const line = out.mine.direct.find((d) => d.label === 'CI Tool');
    expect(line).toMatchObject({ budget: 300, actualToDate: 120, remaining: 180 });
    expect(out.mine.indirect.map((i) => i.description)).toContain('Site travel');
    expect(out.mine.summary.directActual).toBe(120);
    expect(out.unknown.error).toBeTruthy(); // OTHER-1 not in the caller's accessible set → no leak
  });

  it('get_schedule_detail returns the CPM network with a critical path; inaccessible → friendly error', async () => {
    __setAiPort(scriptPort(async (ex) => ({
      mine: JSON.parse(await ex('get_schedule_detail', { project_code: 'MINE-1' })),
      unknown: JSON.parse(await ex('get_schedule_detail', { project_code: 'OTHER-1' })),
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    const out = JSON.parse(res.body.answer) as {
      mine: { summary: { taskCount: number; hasNetwork: boolean; criticalCount: number }; tasks: { wbs: string; critical: boolean; totalFloat: number }[] };
      unknown: { error?: string };
    };
    expect(out.mine.summary.taskCount).toBe(2);
    expect(out.mine.summary.hasNetwork).toBe(true);
    expect(out.mine.tasks.some((t) => t.critical)).toBe(true); // at least one activity on the critical path
    expect(out.mine.tasks.map((t) => t.wbs)).toEqual(expect.arrayContaining(['1.1', '1.2']));
    expect(out.unknown.error).toBeTruthy();
  });

  it('get_project_raid returns issues + assumptions + dependencies; inaccessible → friendly error', async () => {
    __setAiPort(scriptPort(async (ex) => ({
      mine: JSON.parse(await ex('get_project_raid', { project_code: 'MINE-1' })),
      unknown: JSON.parse(await ex('get_project_raid', { project_code: 'OTHER-1' })),
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    const out = JSON.parse(res.body.answer) as {
      mine: { issues: { code: string; status: string }[]; assumptions: { code: string }[]; dependencies: { code: string; counterparty: string | null }[] };
      unknown: { error?: string };
    };
    expect(out.mine.issues).toMatchObject([{ code: 'ISS-001', status: 'OPEN' }]);
    expect(out.mine.assumptions.map((a) => a.code)).toEqual(['ASM-001']);
    expect(out.mine.dependencies).toMatchObject([{ code: 'DEP-001', counterparty: 'Platform' }]);
    expect(out.unknown.error).toBeTruthy();
  });

  it('list_requirements returns requirements with coverage/traceability; inaccessible → friendly error', async () => {
    __setAiPort(scriptPort(async (ex) => ({
      mine: JSON.parse(await ex('list_requirements', { project_code: 'MINE-1' })),
      unknown: JSON.parse(await ex('list_requirements', { project_code: 'OTHER-1' })),
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    const out = JSON.parse(res.body.answer) as {
      mine: { requirements: { code: string; priority: string; covered: boolean; linkedWbs: string[] }[]; coverage: { total: number; covered: number } };
      unknown: { error?: string };
    };
    expect(out.mine.requirements).toMatchObject([{ code: 'REQ-001', priority: 'MUST', covered: true, linkedWbs: ['1.2'] }]);
    expect(out.mine.coverage).toMatchObject({ total: 1, covered: 1 });
    expect(out.unknown.error).toBeTruthy();
  });

  it('tool path: query_data surfaces a `tables` payload; a bad spec returns an error, no table', async () => {
    __setAiPort(scriptPort(async (ex) => ({
      ok: await ex('query_data', { entity: 'projects', filters: [{ field: 'overdueTasks', op: 'gt', value: 0 }] }),
      bad: await ex('query_data', { entity: 'projects', filters: [{ field: 'nope', op: 'eq', value: 1 }] }),
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer) as { ok: string; bad: string };
    expect(out.ok).toContain('"ok":true');
    expect(out.bad).toContain('tidak ada'); // unknown field message
    // Only the valid query produced a table for the client.
    expect(res.body.tables.length).toBe(1);
    expect(res.body.tables[0].entity).toBe('projects');
    expect(res.body.tables[0].rows.map((r: { code: string }) => r.code)).toContain('MINE-1');
    expect(res.body.tables[0].rows.map((r: { code: string }) => r.code)).not.toContain('OTHER-1');
  });
});
