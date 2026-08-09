import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runAutomations } from '../automation/automation.service.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken: string;
let viewerToken: string;
let pmId: string;
let projectId: string;

beforeAll(async () => {
  const r = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (r.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${r.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const admin = await prisma.user.create({ data: { name: 'Auto Admin', email: 'auto-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  const viewer = await prisma.user.create({ data: { name: 'Auto Viewer', email: 'auto-viewer@corp.test', role: 'VIEWER', passwordHash: await hashPassword('View-Pass-1'), isActive: true } });
  const pm = await prisma.user.create({ data: { name: 'Auto PM', email: 'auto-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('Pm-Pass-1'), isActive: true } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email });
  pmId = pm.id;
  const project = await prisma.project.create({ data: { code: 'AUTO-1', name: 'Automation Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
  projectId = project.id;
});

const pmNotifs = () => prisma.notification.count({ where: { userId: pmId, type: 'AUTOMATION' } });

describe('No-code automations (No-Code Automations)', () => {
  it('creates a rule (ADMIN) and lists it; rejects a non-admin and a rule with no recipient', async () => {
    const ok = await request(app).post(api('/automations')).set(auth(adminToken)).send({ name: 'Notify PM on new risk', event: 'risk.created', notifyPm: true });
    expect(ok.status).toBe(201);
    const list = await request(app).get(api('/automations')).set(auth(adminToken));
    expect(list.body.rules.length).toBeGreaterThanOrEqual(1);
    expect((await request(app).post(api('/automations')).set(auth(viewerToken)).send({ name: 'x', event: 'risk.created', notifyPm: true })).status).toBe(403);
    expect((await request(app).post(api('/automations')).set(auth(adminToken)).send({ name: 'no recipient', event: 'risk.created' })).status).toBe(400);
  });

  it('fires a matching rule → notifies the project PM', async () => {
    const before = await pmNotifs();
    await runAutomations('risk.created', { projectId, code: 'R-1', title: 'Server melts' });
    expect(await pmNotifs()).toBe(before + 1);
    const n = await prisma.notification.findFirst({ where: { userId: pmId, type: 'AUTOMATION' }, orderBy: { createdAt: 'desc' } });
    expect(n?.projectId).toBe(projectId);
  });

  it('honours a field condition (only fires when payload matches)', async () => {
    await request(app).post(api('/automations')).set(auth(adminToken)).send({
      name: 'On hold only', event: 'project.status_changed', notifyPm: true,
      conditionField: 'to', conditionEquals: 'ON_HOLD',
    });
    const before = await pmNotifs();
    await runAutomations('project.status_changed', { id: projectId, name: 'Automation Test', from: 'IN_PROGRESS', to: 'IN_PROGRESS' });
    expect(await pmNotifs()).toBe(before); // condition not met → no notify
    await runAutomations('project.status_changed', { id: projectId, name: 'Automation Test', from: 'IN_PROGRESS', to: 'ON_HOLD' });
    expect(await pmNotifs()).toBe(before + 1); // condition met
  });

  it('deletes a rule', async () => {
    const created = await request(app).post(api('/automations')).set(auth(adminToken)).send({ name: 'to delete', event: 'baseline.locked', notifyPm: true });
    const del = await request(app).delete(api(`/automations/${created.body.id}`)).set(auth(adminToken));
    expect(del.status).toBe(200);
  });
});
