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
    await prisma.task.create({ data: { projectId: mine1.id, wbsCode: '1.1', name: 'Late task', planStart: past, planEnd: past, progressPct: 50 } });
    await prisma.task.create({ data: { projectId: mine2.id, wbsCode: '1.1', name: 'On track', planStart: past, planEnd: future, progressPct: 20 } });
    await prisma.changeRequest.create({ data: { projectId: mine1.id, type: 'SCOPE', title: 'Add scope', description: 'More work', requestedBy: pm.id, status: 'SUBMITTED' } });
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

  it('tasks: filter overdue=true across accessible projects', async () => {
    const table = await runWithTenant(tid, () => runQuery({ entity: 'tasks', filters: [{ field: 'overdue', op: 'eq', value: true }] }, pmId, 'PROJECT_MANAGER'));
    expect(table.rows.map((r) => r.name)).toEqual(['Late task']);
    expect(table.rows[0].project).toBe('MINE-1');
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
