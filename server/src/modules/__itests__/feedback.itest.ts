import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { __setMailSink, type MailMessage } from '../../lib/mailer.js';
import { wipeDb, seedGuestOrg, apiPath } from '../../test/tenancy.harness.js';
import { signAccessToken } from '../../lib/jwt.js';
import { hashPassword } from '../../lib/password.js';

async function seedAdmin() {
  const user = await prisma.user.create({ data: { name: 'Admin', email: `admin-${Date.now()}@corp.test`, role: 'ADMIN', passwordHash: await hashPassword('Admin-Harness-1'), isActive: true } });
  const tenant = await prisma.tenant.create({ data: { slug: `corp-${user.id}`, name: 'Corp' } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'ADMIN' } });
  const token = signAccessToken({ sub: user.id, role: 'ADMIN', email: user.email, tv: 0, tid: tenant.id });
  return { userId: user.id, auth: { Authorization: `Bearer ${token}` } };
}

// In-app product feedback: any signed-in user (incl. guests) can post; it stores a row and fires a
// best-effort admin email (captured via the mail sink so no SMTP/network is needed).
const app = createApp();
let captured: MailMessage[] = [];

beforeAll(() => { __setMailSink((m) => captured.push(m)); });
afterAll(() => { __setMailSink(null); });
beforeEach(async () => { await wipeDb(); captured = []; });

describe('in-app feedback', () => {
  it('stores feedback (with context) and notifies the admin inbox', async () => {
    const org = await seedGuestOrg('F');
    const res = await request(app).post(apiPath('/feedback')).set(org.auth).send({
      type: 'BUG',
      message: 'The Gantt bar is misaligned on mobile.',
      pageUrl: '/projects/x?tab=Schedule',
      release: 'test-1',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();

    const row = await runAsSystem(() => prisma.feedback.findUnique({ where: { id: res.body.id } }));
    expect(row?.type).toBe('BUG');
    expect(row?.userId).toBe(org.userId);
    expect(row?.role).toBe('GUEST');
    expect(row?.status).toBe('OPEN');
    expect(row?.message).toContain('misaligned');
    expect(row?.pageUrl).toBe('/projects/x?tab=Schedule');

    // best-effort admin email captured
    expect(captured).toHaveLength(1);
    expect(captured[0].subject).toContain('BUG');
    expect(captured[0].text).toContain('misaligned');
  });

  it('rejects an invalid type or too-short message (400), sends no email', async () => {
    const org = await seedGuestOrg('G');
    const badType = await request(app).post(apiPath('/feedback')).set(org.auth).send({ type: 'SPAM', message: 'hello there' });
    expect(badType.status).toBe(400);
    const tooShort = await request(app).post(apiPath('/feedback')).set(org.auth).send({ type: 'IDEA', message: 'x' });
    expect(tooShort.status).toBe(400);
    expect(captured).toHaveLength(0);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).post(apiPath('/feedback')).send({ type: 'IDEA', message: 'an anonymous idea' });
    expect(res.status).toBe(401);
  });

  it('admin can list + triage feedback; a guest is forbidden', async () => {
    const admin = await seedAdmin();
    const created = await request(app).post(apiPath('/feedback')).set(admin.auth).send({ type: 'IDEA', message: 'Add dark mode to the reports export' });
    expect(created.status).toBe(201);

    const list = await request(app).get(apiPath('/admin/feedback?status=OPEN')).set(admin.auth);
    expect(list.status).toBe(200);
    expect(list.body.items.some((f: { id: string }) => f.id === created.body.id)).toBe(true);

    const patch = await request(app).patch(apiPath(`/admin/feedback/${created.body.id}`)).set(admin.auth).send({ status: 'REVIEWED' });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe('REVIEWED');

    const guest = await seedGuestOrg('H');
    const denied = await request(app).get(apiPath('/admin/feedback')).set(guest.auth);
    expect(denied.status).toBe(403);
  });
});
