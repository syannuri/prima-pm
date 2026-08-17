import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Phase 6 — Lemon Squeezy self-serve billing. Exercises the webhook that flips Tenant.plan:
// signature verification, an upgrade (TRIAL→PRO), and expiry (→TRIAL, the upgrade wall). No network
// calls (the LS API is only hit by checkout/portal, not by the webhook path).
const WEBHOOK_SECRET = 'whsec_test_billing';
const PRO_VARIANT = '900001';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// Sign a webhook body exactly as Lemon Squeezy does: hex HMAC-SHA256 of the raw bytes.
function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body)).digest('hex');
}
function subEvent(eventName: string, tenantId: string, attrs: Record<string, unknown>) {
  return JSON.stringify({
    meta: { event_name: eventName, custom_data: { tenant_id: tenantId } },
    data: { type: 'subscriptions', id: 'sub_777', attributes: attrs },
  });
}

let prevFlag: string | undefined;
let prevSecret: string | undefined;
let prevVariant: string | undefined;
let tenantId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  prevVariant = process.env.LEMONSQUEEZY_VARIANT_ID_PRO;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.LEMONSQUEEZY_API_KEY = 'test-key'; // enables billing (with the secret below)
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.LEMONSQUEEZY_VARIANT_ID_PRO = PRO_VARIANT;

  await wipeDb();
  await backfillDefaultTenant(prisma);
  // Start mid-trial (deadline in the future) so we can prove a paid subscription CLEARS it.
  const t = await prisma.tenant.create({ data: { slug: 'billco', name: 'Bill Co', trialEndsAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) } }); // TRIAL (default)
  tenantId = t.id;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevSecret === undefined) delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  else process.env.LEMONSQUEEZY_WEBHOOK_SECRET = prevSecret;
  if (prevVariant === undefined) delete process.env.LEMONSQUEEZY_VARIANT_ID_PRO;
  else process.env.LEMONSQUEEZY_VARIANT_ID_PRO = prevVariant;
  delete process.env.LEMONSQUEEZY_API_KEY;
});

describe('lemonsqueezy webhook', () => {
  it('rejects a body with a bad signature', async () => {
    const body = subEvent('subscription_created', tenantId, { status: 'active', variant_id: PRO_VARIANT });
    const res = await request(app)
      .post('/webhooks/lemonsqueezy')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'deadbeef')
      .send(body);
    expect(res.status).toBe(401);
    // Plan unchanged.
    expect((await prisma.tenant.findUnique({ where: { id: tenantId } }))!.plan).toBe('TRIAL');
  });

  it('flips TRIAL → PRO on a signed subscription_created and records a BillingEvent', async () => {
    const body = subEvent('subscription_created', tenantId, {
      status: 'active',
      variant_id: PRO_VARIANT,
      customer_id: 5551,
      renews_at: '2027-01-01T00:00:00.000Z',
    });
    const res = await request(app)
      .post('/webhooks/lemonsqueezy')
      .set('Content-Type', 'application/json')
      .set('X-Signature', sign(body))
      .send(body);
    expect(res.status).toBe(200);

    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t!.plan).toBe('PRO');
    expect(t!.trialEndsAt).toBeNull(); // a paid plan clears the trial deadline
    expect(t!.subscriptionStatus).toBe('active');
    expect(t!.lsSubscriptionId).toBe('sub_777');
    const events = await prisma.billingEvent.findMany({ where: { tenantId } });
    expect(events).toHaveLength(1);
    expect(events[0].planAfter).toBe('PRO');
  });

  it('downgrades to TRIAL (upgrade wall) on subscription_expired', async () => {
    const body = subEvent('subscription_expired', tenantId, { status: 'expired', variant_id: PRO_VARIANT });
    const res = await request(app)
      .post('/webhooks/lemonsqueezy')
      .set('Content-Type', 'application/json')
      .set('X-Signature', sign(body))
      .send(body);
    expect(res.status).toBe(200);
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t!.plan).toBe('TRIAL');
    // Expiry stamps a PAST deadline → reads as an EXPIRED trial (the upgrade wall), not a fresh one.
    expect(t!.trialEndsAt).toBeTruthy();
    expect(t!.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('ignores an unhandled event name with 200', async () => {
    const body = JSON.stringify({ meta: { event_name: 'order_created', custom_data: { tenant_id: tenantId } }, data: {} });
    const res = await request(app)
      .post('/webhooks/lemonsqueezy')
      .set('Content-Type', 'application/json')
      .set('X-Signature', sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe('order_created');
  });
});
