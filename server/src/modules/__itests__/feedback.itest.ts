import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { __setMailSink, type MailMessage } from '../../lib/mailer.js';
import { wipeDb, seedGuestOrg, apiPath } from '../../test/tenancy.harness.js';

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
});
