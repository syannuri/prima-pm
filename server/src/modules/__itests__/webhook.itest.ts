import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { signWebhook, SIGNATURE_HEADER, EVENT_HEADER } from '../../lib/webhook.js';
import * as webhooks from '../webhook/webhook.service.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken: string;
let viewerToken: string;
let adminId: string;

// Mock the global fetch used by the delivery worker; each test sets its own response.
const okResponse = { ok: true, status: 200 } as Response;
function mockFetch(res: Partial<Response> = okResponse) {
  const fn = vi.fn(async () => res as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeAll(async () => {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  const admin = await prisma.user.create({ data: { name: 'WH Admin', email: 'wh-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  const viewer = await prisma.user.create({ data: { name: 'WH Viewer', email: 'wh-viewer@corp.test', role: 'VIEWER', passwordHash: await hashPassword('View-Pass-1'), isActive: true } });
  adminId = admin.id;
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email });
  // Drive delivery explicitly in tests (no fire-and-forget sweep racing our assertions).
  webhooks.__setAutoDeliver(false);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Outbound webhooks (T3.3)', () => {
  it('lets an ADMIN create a subscription, returning the signing secret once', async () => {
    const res = await request(app).post(api('/webhooks')).set(auth(adminToken)).send({ url: 'https://example.test/hook', events: ['project.created'] });
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^whsec_/);
    // List never exposes the secret.
    const list = await request(app).get(api('/webhooks')).set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.subscriptions.every((s: { secret?: string }) => s.secret === undefined)).toBe(true);
  });

  it('rejects subscription creation for a non-admin, and a non-https URL', async () => {
    const forbidden = await request(app).post(api('/webhooks')).set(auth(viewerToken)).send({ url: 'https://example.test/hook', events: ['*'] });
    expect(forbidden.status).toBe(403);
    const badUrl = await request(app).post(api('/webhooks')).set(auth(adminToken)).send({ url: 'http://insecure.test/hook', events: ['*'] });
    expect(badUrl.status).toBe(400);
  });

  it('delivers a matching event with a valid HMAC signature + headers, marking it SUCCESS', async () => {
    const sub = await webhooks.createSubscription({ url: 'https://example.test/deliver', events: ['project.created'] }, adminId);
    const fetchMock = mockFetch({ ok: true, status: 200 } as Response);

    await webhooks.enqueueWebhookEvent('project.created', { id: 'p1', code: 'PRJ-1' });
    await webhooks.deliverDueDeliveries();

    // Other tests' subscriptions may also listen for this event; assert on OUR delivery's call.
    const call = fetchMock.mock.calls.find((c) => c[0] === 'https://example.test/deliver') as [string, RequestInit & { headers: Record<string, string> }] | undefined;
    expect(call).toBeTruthy();
    const [url, opts] = call!;
    expect(url).toBe('https://example.test/deliver');
    expect(opts.headers[EVENT_HEADER]).toBe('project.created');
    // Recompute the signature over `${t}.${body}` with the sub's secret and compare.
    const sig = opts.headers[SIGNATURE_HEADER];
    const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(sig);
    expect(m).toBeTruthy();
    const [, t, v1] = m!;
    expect(v1).toBe(signWebhook(sub.secret, Number(t), opts.body as string));

    const delivery = await prisma.webhookDelivery.findFirst({ where: { subscriptionId: sub.id }, orderBy: { createdAt: 'desc' } });
    expect(delivery?.status).toBe('SUCCESS');
    expect(delivery?.attempts).toBe(1);
  });

  it('does NOT deliver an event a subscription is not subscribed to', async () => {
    const sub = await webhooks.createSubscription({ url: 'https://example.test/only-baseline', events: ['baseline.locked'] }, adminId);
    const fetchMock = mockFetch();

    await webhooks.enqueueWebhookEvent('project.created', { id: 'p2' });
    await webhooks.deliverDueDeliveries();

    const delivery = await prisma.webhookDelivery.findFirst({ where: { subscriptionId: sub.id } });
    expect(delivery).toBeNull(); // no delivery row for a non-subscribed event
    void fetchMock;
  });

  it('retries (stays PENDING with backoff) when the endpoint returns a non-2xx', async () => {
    const sub = await webhooks.createSubscription({ url: 'https://example.test/flaky', events: ['project.created'] }, adminId);
    mockFetch({ ok: false, status: 500 } as Response);

    await webhooks.enqueueWebhookEvent('project.created', { id: 'p3' });
    await webhooks.deliverDueDeliveries();

    const delivery = await prisma.webhookDelivery.findFirst({ where: { subscriptionId: sub.id }, orderBy: { createdAt: 'desc' } });
    expect(delivery?.status).toBe('PENDING');
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.responseStatus).toBe(500);
    expect(delivery && delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now()); // backed off
  });
});
