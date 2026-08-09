import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let pmToken: string;

beforeAll(async () => {
  const r = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (r.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${r.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const pm = await prisma.user.create({ data: { name: 'Cal PM', email: 'cal-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('Pm-Pass-1'), isActive: true } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email });
  const project = await prisma.project.create({ data: { code: 'CAL-1', name: 'Calendar Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
  await prisma.task.create({ data: { projectId: project.id, wbsCode: '1', name: 'Design phase', planStart: new Date('2026-01-01'), planEnd: new Date('2026-01-10') } });
  await prisma.task.create({ data: { projectId: project.id, wbsCode: '2', name: 'Go-live', planStart: new Date('2026-02-01'), planEnd: new Date('2026-02-01'), isMilestone: true } });
});

const tokenFromUrl = (url: string) => url.match(/calendar\/([^/]+)\/feed\.ics/)?.[1] ?? '';

describe('Calendar feed (T4.2)', () => {
  it('issues a feed URL for the authed user', async () => {
    const res = await request(app).get(api('/calendar/feed')).set(auth(pmToken));
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\/api\/v1\/calendar\/[\w-]+\/feed\.ics$/);
  });

  it('serves the public .ics with the user’s tasks + milestone marker (no auth)', async () => {
    const url = (await request(app).get(api('/calendar/feed')).set(auth(pmToken))).body.url;
    const token = tokenFromUrl(url);
    const res = await request(app).get(api(`/calendar/${token}/feed.ics`)); // no auth
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('Design phase');
    expect(res.text).toContain('◆ [CAL-1] Go-live'); // milestone marker + project code
  });

  it('rotate invalidates the old token', async () => {
    const oldUrl = (await request(app).get(api('/calendar/feed')).set(auth(pmToken))).body.url;
    const oldToken = tokenFromUrl(oldUrl);
    const rotated = await request(app).post(api('/calendar/feed/rotate')).set(auth(pmToken));
    expect(rotated.status).toBe(200);
    expect(tokenFromUrl(rotated.body.url)).not.toBe(oldToken);
    // Old token no longer resolves.
    expect((await request(app).get(api(`/calendar/${oldToken}/feed.ics`))).status).toBe(404);
  });

  it('unknown token → 404', async () => {
    expect((await request(app).get(api('/calendar/nope-not-a-real-token/feed.ics'))).status).toBe(404);
  });
});
