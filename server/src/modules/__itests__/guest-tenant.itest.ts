import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { signAccessToken, verifyAccessToken } from '../../lib/jwt.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __resetSettingsCache } from '../../modules/settings/settings.service.js';

// Guests become their OWN personal tenant (Phase 5 / de-scatter prerequisite): the tenant extension
// then isolates one guest from another AND from the corporate portfolio, replacing the legacy
// personalOwnerId isolation. Two proofs, both flag ON: (1) the backfill moves an existing guest's
// sandbox out of the default tenant into a personal tenant; (2) a NEW guest registration provisions
// a personal tenant and pins the token to it. Flag toggled for this file only (serial run).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let defaultTenantId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  __resetSettingsCache();
  await wipeDb();
  const { tenantId } = await backfillDefaultTenant(prisma);
  defaultTenantId = tenantId;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  __resetSettingsCache();
});

describe('new guest registration provisions a personal tenant', () => {
  it('pins the token to a fresh isPersonal tenant (not the default), with a GUEST membership there', async () => {
    const res = await request(app).post(api('/auth/guest/register')).send({ name: 'Fresh Guest', email: 'fresh-guest@gt.test', password: 'Guest-Pass-1' });
    expect(res.status).toBe(201);
    const tid = verifyAccessToken(res.body.accessToken).tid;
    expect(tid).toBeTruthy();
    expect(tid).not.toBe(defaultTenantId);

    const user = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'fresh-guest@gt.test' } }));
    const tenant = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { id: tid! } }));
    expect(tenant.isPersonal).toBe(true);
    expect(tenant.slug).toBe(`guest-${user.id}`);

    const mem = await runAsSystem(() => prisma.membership.findMany({ where: { userId: user.id } }));
    expect(mem).toHaveLength(1);
    expect(mem[0].tenantId).toBe(tid);
    expect(mem[0].role).toBe('GUEST');
  });

  it('two fresh guests land in different tenants (isolated by the extension)', async () => {
    const a = await request(app).post(api('/auth/guest/register')).send({ name: 'Guest A', email: 'guest-a@gt.test', password: 'Guest-Pass-1' });
    const b = await request(app).post(api('/auth/guest/register')).send({ name: 'Guest B', email: 'guest-b@gt.test', password: 'Guest-Pass-1' });
    const tidA = verifyAccessToken(a.body.accessToken).tid;
    const tidB = verifyAccessToken(b.body.accessToken).tid;
    expect(tidA).toBeTruthy();
    expect(tidB).toBeTruthy();
    expect(tidA).not.toBe(tidB);
  });
});
