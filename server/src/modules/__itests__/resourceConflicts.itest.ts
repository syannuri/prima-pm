import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';

// AI resource-conflict detection + reallocation draft. Detection is deterministic (no key needed);
// the ai-draft route uses an injected fake AiPort. Runs enforce=false → ADMIN sees all projects.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken = '', viewerToken = '';
let resOver = '', resFree = '';
let prevKey: string | undefined;

const MAR_START = new Date('2026-03-02T00:00:00Z'); // Mon
const MAR_END = new Date('2026-03-31T00:00:00Z');   // Tue (~22 business days)

async function manpower(projectId: string, taskName: string, resourceId: string, planMandays: number) {
  const task = await prisma.task.create({ data: { projectId, wbsCode: '1', name: taskName, planStart: MAR_START, planEnd: MAR_END, progressPct: 0 } });
  await prisma.costItemDirect.create({ data: {
    projectId, type: 'MANPOWER', label: taskName, taskId: task.id, resourceId,
    personnelRole: 'PROJECT_PERSONNEL', planMandays, unitCostPerManday: 0, manpowerCost: 0,
  } });
}

beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';

  const admin = await prisma.user.create({ data: { name: 'RC Admin', email: 'rc-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  const viewer = await prisma.user.create({ data: { name: 'RC View', email: 'rc-view@corp.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email });

  const rOver = await prisma.resource.create({ data: { name: 'Andi', capacityPerDay: 1, personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 0 } });
  const rFree = await prisma.resource.create({ data: { name: 'Budi', capacityPerDay: 1, personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 0 } });
  resOver = rOver.id; resFree = rFree.id;

  const p1 = await prisma.project.create({ data: { code: 'RC-1', name: 'Proj 1', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' } });
  const p2 = await prisma.project.create({ data: { code: 'RC-2', name: 'Proj 2', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' } });
  // Andi is booked ~40 man-days into a ~22-business-day month across two projects → over-allocated.
  await manpower(p1.id, 'Design (P1)', resOver, 20);
  await manpower(p2.id, 'Build (P2)', resOver, 20);
  // Budi is barely loaded → an eligible reassignment target.
  await manpower(p1.id, 'Review (P1)', resFree, 2);
});

afterAll(async () => {
  __setAiPort(null);
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('resource conflicts — GET /resources/conflicts', () => {
  it('401 without auth', async () => {
    expect((await request(app).get(api('/resources/conflicts'))).status).toBe(401);
  });

  it('detects the over-allocated resource with contributions + an eligible candidate', async () => {
    const res = await request(app).get(api('/resources/conflicts')).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.aiAvailable).toBe(true); // env set, no tenant gate in enforce=false
    const c = res.body.conflicts.find((x: { resourceName: string }) => x.resourceName === 'Andi');
    expect(c).toBeTruthy();
    expect(c.overBy).toBeGreaterThan(0);
    // Both projects' manpower lines are attributed as contributions.
    expect(c.contributions.map((x: { projectCode: string }) => x.projectCode).sort()).toEqual(['RC-1', 'RC-2']);
    // Budi is offered as a reassignment target.
    expect(c.candidates.map((x: { resourceId: string }) => x.resourceId)).toContain(resFree);
  });
});

describe('AI reallocation draft — POST /resources/conflicts/ai-draft', () => {
  it('returns grounded moves and DROPS hallucinated ids', async () => {
    const list = await request(app).get(api('/resources/conflicts')).set(bearer(adminToken));
    const conflict = list.body.conflicts.find((x: { resourceName: string }) => x.resourceName === 'Andi');
    const realCostItem = conflict.contributions[0].costItemId;

    const port: AiPort = {
      async draftJson() {
        return {
          summary: 'Pindahkan sebagian beban Andi ke Budi.',
          moves: [
            { costItemId: realCostItem, toResourceId: resFree, toResourceName: 'Budi', taskName: 'Design (P1)', fromResourceName: 'Andi', projectId: conflict.contributions[0].projectId, rationale: 'Budi longgar' },
            { costItemId: 'HALLUCINATED', toResourceId: resFree, toResourceName: 'Budi', taskName: 'Ghost', fromResourceName: 'Andi', projectId: 'x', rationale: 'invalid' },
          ],
          confidence: 'MEDIUM',
        };
      },
      async draftNarrative() { return null; },
    };
    __setAiPort(port);

    const res = await request(app).post(api('/resources/conflicts/ai-draft')).set(bearer(adminToken)).send(conflict);
    __setAiPort(null);
    expect(res.status).toBe(200);
    expect(res.body.moves).toHaveLength(1); // hallucinated costItemId dropped
    expect(res.body.moves[0].costItemId).toBe(realCostItem);
  });

  it('503 when the AI key is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const list = await request(app).get(api('/resources/conflicts')).set(bearer(adminToken));
    const conflict = list.body.conflicts[0];
    const res = await request(app).post(api('/resources/conflicts/ai-draft')).set(bearer(adminToken)).send(conflict);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(res.status).toBe(503);
  });
});
