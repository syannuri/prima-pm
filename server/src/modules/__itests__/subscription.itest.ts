import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { runTrialReminderSweep } from '../billing/trialReminders.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Phase 6 — 60-day TRIAL lifecycle + full-lockout upgrade wall (docs/SUBSCRIPTION-PLANS-PLAN.md).
// Runs enforcement-ON (the wall is wired into requireAuth under enforcement only).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const DAY = 24 * 60 * 60 * 1000;

let prevFlag: string | undefined;
let platformToken = '';
let defaultTid = '';

// Create a corporate tenant + an ADMIN owner and return a tid-pinned token.
async function makeTenant(slug: string, data: { plan?: 'TRIAL' | 'PRO' | 'ENTERPRISE'; trialEndsAt?: Date | null; isPersonal?: boolean } = {}) {
  const t = await runAsSystem(() => prisma.tenant.create({ data: { slug, name: slug, isPersonal: data.isPersonal ?? false, plan: data.plan ?? 'TRIAL', trialEndsAt: data.trialEndsAt ?? null } }));
  const owner = await prisma.user.create({ data: { name: slug, email: `owner@${slug}.test`, role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true, isGuest: !!data.isPersonal } });
  await runAsSystem(() => prisma.membership.create({ data: { userId: owner.id, tenantId: t.id, role: data.isPersonal ? 'GUEST' : 'ADMIN' } }));
  const token = signAccessToken({ sub: owner.id, role: data.isPersonal ? 'GUEST' : 'ADMIN', email: owner.email, tv: 0, tid: t.id });
  return { tenantId: t.id, token };
}

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  ({ tenantId: defaultTid } = await backfillDefaultTenant(prisma));
  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@sub.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('trial upgrade wall', () => {
  it('an EXPIRED trial is 402-walled on app routes, but auth + billing stay reachable', async () => {
    const { token } = await makeTenant('expiredco', { plan: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY) });

    // Reads and writes on app routes are blocked.
    const read = await request(app).get(api('/projects')).set(bearer(token));
    expect(read.status).toBe(402);
    expect(read.body.error.code).toBe('PAYMENT_REQUIRED');
    const write = await request(app).post(api('/projects')).set(bearer(token)).send({ name: 'nope' });
    expect(write.status).toBe(402);

    // Auth (session state) stays reachable, and reports the expired trial + capabilities.
    const me = await request(app).get(api('/auth/me')).set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.workspace.trialExpired).toBe(true);
    expect(me.body.workspace.plan).toBe('TRIAL');
    expect(me.body.workspace.capabilities).toContain('portfolio');
    expect(me.body.workspace.capabilities).not.toContain('sso');

    // Billing stays reachable so the admin can upgrade.
    const billing = await request(app).get(api('/billing/status')).set(bearer(token));
    expect(billing.status).toBe(200);
  });

  it('a platform upgrade to PRO lifts the wall', async () => {
    const { tenantId, token } = await makeTenant('upgradeco', { plan: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY) });
    expect((await request(app).get(api('/projects')).set(bearer(token))).status).toBe(402);

    expect((await request(app).patch(api(`/admin/tenants/${tenantId}`)).set(bearer(platformToken)).send({ plan: 'PRO' })).status).toBe(200);

    // PRO never expires → the wall is gone.
    expect((await request(app).get(api('/projects')).set(bearer(token))).status).toBe(200);
    const me = await request(app).get(api('/auth/me')).set(bearer(token));
    expect(me.body.workspace.plan).toBe('PRO');
    expect(me.body.workspace.trialExpired).toBe(false);
  });

  it('an ACTIVE trial (deadline in the future) is not walled and reports days left', async () => {
    const { token } = await makeTenant('activeco', { plan: 'TRIAL', trialEndsAt: new Date(Date.now() + 30 * DAY) });
    expect((await request(app).get(api('/projects')).set(bearer(token))).status).toBe(200);
    const me = await request(app).get(api('/auth/me')).set(bearer(token));
    expect(me.body.workspace.trialExpired).toBe(false);
    expect(me.body.workspace.trialDaysLeft).toBeGreaterThan(0);
    expect(me.body.workspace.trialDaysLeft).toBeLessThanOrEqual(30);
  });

  it('a PERSONAL (guest) tenant is exempt even with a past trial deadline', async () => {
    const { token } = await makeTenant('guestco', { plan: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY), isPersonal: true });
    expect((await request(app).get(api('/projects')).set(bearer(token))).status).toBe(200);
    const me = await request(app).get(api('/auth/me')).set(bearer(token));
    expect(me.body.workspace.trialExpired).toBe(false); // personal → never walled
  });
});

describe('trial admin ops', () => {
  it('a platform admin extends a trial (never shortening); a non-TRIAL plan is refused', async () => {
    const { tenantId } = await makeTenant('extendco', { plan: 'TRIAL', trialEndsAt: new Date(Date.now() + 2 * DAY) });
    const res = await request(app).post(api(`/admin/tenants/${tenantId}/extend-trial`)).set(bearer(platformToken)).send({ days: 30 });
    expect(res.status).toBe(200);
    expect(new Date(res.body.tenant.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 28 * DAY);

    const { tenantId: proId } = await makeTenant('proextendco', { plan: 'PRO' });
    expect((await request(app).post(api(`/admin/tenants/${proId}/extend-trial`)).set(bearer(platformToken)).send({ days: 30 })).status).toBe(400);
  });

  it('the trial-reminder sweep notifies admins once per bucket (idempotent)', async () => {
    const t = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'remindco', name: 'Remind Co', plan: 'TRIAL', trialEndsAt: new Date(Date.now() + 10 * DAY) } }));
    const admin = await prisma.user.create({ data: { name: 'ra', email: 'ra@remind.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
    await runAsSystem(() => prisma.membership.create({ data: { userId: admin.id, tenantId: t.id, role: 'ADMIN' } }));

    const first = await runTrialReminderSweep();
    expect(first.created).toBeGreaterThanOrEqual(1);
    const notes = await runAsSystem(() => prisma.notification.findMany({ where: { userId: admin.id, type: 'trial-reminder:14' } }));
    expect(notes).toHaveLength(1); // 10 days out ⇒ the 14-day bucket

    // A second sweep creates no duplicate for this admin/bucket.
    await runTrialReminderSweep();
    const after = await runAsSystem(() => prisma.notification.findMany({ where: { userId: admin.id, type: 'trial-reminder:14' } }));
    expect(after).toHaveLength(1);
  });
});
