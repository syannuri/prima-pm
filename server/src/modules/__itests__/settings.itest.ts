import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { env } from '../../config/env.js';
import { __resetSettingsCache } from '../settings/settings.service.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tokens: Record<string, string> = {};

beforeAll(async () => {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  // Google not configured in this file; settings re-seed from env on first read.
  (env as { googleClientId: string }).googleClientId = '';
  __resetSettingsCache();
  for (const role of ['ADMIN', 'PROJECT_MANAGER'] as const) {
    const u = await prisma.user.create({ data: { name: role, email: `${role}@settings.test`, role, passwordHash: await hashPassword('Set-Pass-1'), isActive: true } });
    tokens[role] = signAccessToken({ sub: u.id, role, email: u.email });
  }
});

describe('Admin access settings', () => {
  it('ADMIN reads current settings incl. googleConfigured', async () => {
    const res = await request(app).get(api('/admin/settings')).set(auth(tokens.ADMIN));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ guestSignupEnabled: true, googleConfigured: false }); // GUEST_SIGNUP_ENABLED=true in CI env
  });

  it('non-admin is forbidden', async () => {
    expect((await request(app).get(api('/admin/settings')).set(auth(tokens.PROJECT_MANAGER))).status).toBe(403);
    expect((await request(app).patch(api('/admin/settings')).set(auth(tokens.PROJECT_MANAGER)).send({ guestSignupEnabled: false })).status).toBe(403);
  });

  it('toggling guest sign-up off blocks guest register, and on allows it', async () => {
    await request(app).patch(api('/admin/settings')).set(auth(tokens.ADMIN)).send({ guestSignupEnabled: false });
    // /auth/providers reflects it immediately
    const prov1 = await request(app).get(api('/auth/providers'));
    expect(prov1.body.guestSignup).toBe(false);
    const blocked = await request(app).post(api('/auth/guest/register')).send({ name: 'Ex Plorer', email: 'ex1@guest.test', password: 'Guest-Explore-1' });
    expect(blocked.status).toBe(403);

    await request(app).patch(api('/admin/settings')).set(auth(tokens.ADMIN)).send({ guestSignupEnabled: true });
    const prov2 = await request(app).get(api('/auth/providers'));
    expect(prov2.body.guestSignup).toBe(true);
    const ok = await request(app).post(api('/auth/guest/register')).send({ name: 'Ex Plorer', email: 'ex2@guest.test', password: 'Guest-Explore-1' });
    expect(ok.status).toBe(201);
  });

  it('google toggle stays ineffective while no client ID is configured', async () => {
    const res = await request(app).patch(api('/admin/settings')).set(auth(tokens.ADMIN)).send({ googleLoginEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.googleLoginEnabled).toBe(true); // stored preference
    const prov = await request(app).get(api('/auth/providers'));
    expect(prov.body.google.enabled).toBe(false); // but not effective without a client ID
  });

  it('empty patch is rejected', async () => {
    expect((await request(app).patch(api('/admin/settings')).set(auth(tokens.ADMIN)).send({})).status).toBe(400);
  });
});
