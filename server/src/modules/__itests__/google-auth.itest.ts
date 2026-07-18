import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { env } from '../../config/env.js';
import { __resetSettingsCache } from '../settings/settings.service.js';

// Stub Google token verification: the test "credential" is a JSON identity, so each test
// controls the sub / email / emailVerified without a real Google token. 'invalid' throws.
vi.mock('../../lib/google.js', () => ({
  verifyGoogleIdToken: vi.fn(async (credential: string) => {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(credential);
    } catch {
      throw new Error('invalid token');
    }
    return {
      sub: String(p.sub),
      email: String(p.email).toLowerCase(),
      emailVerified: p.emailVerified !== false,
      name: p.name ?? p.email,
    };
  }),
}));

const app = createApp();
const api = (path: string) => `/api/v1${path}`;
const cred = (o: Record<string, unknown>) => JSON.stringify(o);

const CLIENT_ID = 'test-google-client.apps.googleusercontent.com';

beforeAll(async () => {
  // Clean slate (integration files run serially — vitest fileParallelism:false) so re-runs
  // don't collide on unique email / googleSub.
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  // Enable the feature for this file (env is a plain object; test:integration leaves it unset).
  // Settings seed googleLoginEnabled from Boolean(env.googleClientId) on first read, so set the
  // client ID BEFORE resetting the cache (truncation dropped the AppSetting row → it re-seeds).
  (env as { googleClientId: string }).googleClientId = CLIENT_ID;
  __resetSettingsCache();
  // A staff (non-guest) account whose email Google must NOT be allowed to authenticate into.
  await prisma.user.create({
    data: { name: 'Staff PM', email: 'staff-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('Staff-Pass-1'), isActive: true },
  });
  // An existing GUEST who signed up with a password — Google should LINK to it (same email).
  await prisma.user.create({
    data: { name: 'Existing Guest', email: 'existing-guest@gmail.test', role: 'GUEST', passwordHash: await hashPassword('Guest-Pass-1'), isActive: true },
  });
});

afterAll(() => {
  (env as { googleClientId: string }).googleClientId = '';
  __resetSettingsCache();
});

describe('Sign in with Google', () => {
  it('advertises the provider (client ID is public)', async () => {
    const res = await request(app).get(api('/auth/providers'));
    expect(res.status).toBe(200);
    expect(res.body.google).toEqual({ enabled: true, clientId: CLIENT_ID });
  });

  it('provisions a sandboxed GUEST for a first-time Google user + sets the session cookie', async () => {
    const res = await request(app).post(api('/auth/google')).send({ credential: cred({ sub: 'g-new-1', email: 'newbie@gmail.test', name: 'New Bie' }) });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('GUEST');
    expect(res.body.user.email).toBe('newbie@gmail.test');
    expect((res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('prima_at='))).toBe(true);
    const u = await prisma.user.findUnique({ where: { email: 'newbie@gmail.test' } });
    expect(u?.googleSub).toBe('g-new-1');
    expect(u?.passwordHash).toBeNull();
  });

  it('matches an existing account by Google sub on repeat sign-in (no duplicate)', async () => {
    await request(app).post(api('/auth/google')).send({ credential: cred({ sub: 'g-new-1', email: 'newbie@gmail.test', name: 'New Bie' }) });
    const count = await prisma.user.count({ where: { email: 'newbie@gmail.test' } });
    expect(count).toBe(1);
  });

  it('links Google to an existing GUEST with the same email', async () => {
    const res = await request(app).post(api('/auth/google')).send({ credential: cred({ sub: 'g-link-1', email: 'existing-guest@gmail.test', name: 'Existing Guest' }) });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('GUEST');
    const u = await prisma.user.findUnique({ where: { email: 'existing-guest@gmail.test' } });
    expect(u?.googleSub).toBe('g-link-1');
  });

  it('refuses to authenticate into a staff (non-guest) account', async () => {
    const res = await request(app).post(api('/auth/google')).send({ credential: cred({ sub: 'g-staff-1', email: 'staff-pm@corp.test', name: 'Staff PM' }) });
    expect(res.status).toBe(403);
    const u = await prisma.user.findUnique({ where: { email: 'staff-pm@corp.test' } });
    expect(u?.googleSub).toBeNull(); // not linked
  });

  it('rejects an unverified Google email', async () => {
    const res = await request(app).post(api('/auth/google')).send({ credential: cred({ sub: 'g-unv-1', email: 'unverified@gmail.test', emailVerified: false, name: 'Unv' }) });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    // ≥20 chars so it passes zod validation and reaches the verifier, which rejects it.
    const res = await request(app).post(api('/auth/google')).send({ credential: 'not-a-real-google-id-token-xxxxx' });
    expect(res.status).toBe(401);
  });

  it('403s when the feature is disabled', async () => {
    (env as { googleClientId: string }).googleClientId = '';
    const res = await request(app).post(api('/auth/google')).send({ credential: cred({ sub: 'g-off-1', email: 'off@gmail.test', name: 'Off' }) });
    expect(res.status).toBe(403);
    (env as { googleClientId: string }).googleClientId = CLIENT_ID; // restore for any later files
  });
});
