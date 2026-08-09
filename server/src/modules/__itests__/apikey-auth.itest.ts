import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { hashApiKey } from '../../lib/apiKey.js';
import { __resetApiKeyRateBuckets } from '../../middleware/rateLimit.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken: string;
let viewerToken: string;

beforeAll(async () => {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  const admin = await prisma.user.create({ data: { name: 'Key Admin', email: 'key-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  const viewer = await prisma.user.create({ data: { name: 'Key Viewer', email: 'key-viewer@corp.test', role: 'VIEWER', passwordHash: await hashPassword('View-Pass-1'), isActive: true } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email });
});

describe('API key management + auth (T3.1)', () => {
  it('lets a tenant ADMIN create a key, returning the plaintext ONCE (never the hash)', async () => {
    const res = await request(app).post(api('/api-keys')).set(auth(adminToken)).send({ name: 'CI reader', role: 'VIEWER' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^pk_live_/);
    expect(res.body.prefix).toMatch(/^pk_live_/);
    expect(res.body.hashedKey).toBeUndefined();
    // Stored as the SHA-256 of the plaintext, not the plaintext itself.
    const row = await prisma.apiKey.findFirst({ where: { id: res.body.id } });
    expect(row?.hashedKey).toBe(hashApiKey(res.body.key));
  });

  it('lists keys without exposing the hash or the plaintext', async () => {
    const res = await request(app).get(api('/api-keys')).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.keys.length).toBeGreaterThanOrEqual(1);
    for (const k of res.body.keys) {
      expect(k.hashedKey).toBeUndefined();
      expect(k.key).toBeUndefined();
    }
  });

  it('refuses key creation for a non-admin', async () => {
    const res = await request(app).post(api('/api-keys')).set(auth(viewerToken)).send({ name: 'nope', role: 'VIEWER' });
    expect(res.status).toBe(403);
  });

  it('authenticates a request presenting a valid key (Bearer pk_...)', async () => {
    const created = await request(app).post(api('/api-keys')).set(auth(adminToken)).send({ name: 'live', role: 'VIEWER' });
    const key: string = created.body.key;
    // GET /notifications only needs auth → proves the key authenticated (empty list for this principal).
    const res = await request(app).get(api('/notifications')).set(auth(key));
    expect(res.status).toBe(200);
  });

  it('rejects a write from a key — the public API is read-only', async () => {
    const created = await request(app).post(api('/api-keys')).set(auth(adminToken)).send({ name: 'ro', role: 'ADMIN' });
    const key: string = created.body.key;
    const res = await request(app).post(api('/api-keys')).set(auth(key)).send({ name: 'x', role: 'VIEWER' });
    expect(res.status).toBe(403); // "API keys are read-only" (enforced in requireAuth before the route)
  });

  it('rejects a revoked key with 401', async () => {
    const created = await request(app).post(api('/api-keys')).set(auth(adminToken)).send({ name: 'to-revoke', role: 'VIEWER' });
    const key: string = created.body.key;
    const del = await request(app).delete(api(`/api-keys/${created.body.id}`)).set(auth(adminToken));
    expect(del.status).toBe(200);
    const res = await request(app).get(api('/notifications')).set(auth(key));
    expect(res.status).toBe(401);
  });

  it('rejects an unknown key with 401', async () => {
    const res = await request(app).get(api('/notifications')).set(auth('pk_live_totally-made-up-key-value-xxxxxxxx'));
    expect(res.status).toBe(401);
  });

  it('records an API_ACCESS audit entry for a keyed request', async () => {
    const created = await request(app).post(api('/api-keys')).set(auth(adminToken)).send({ name: 'audited', role: 'VIEWER' });
    const key: string = created.body.key;
    await request(app).get(api('/notifications')).set(auth(key));
    // Audit is fire-and-forget; poll briefly for the row.
    let row = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await prisma.auditLog.findFirst({ where: { action: 'API_ACCESS', entityId: created.body.id } });
      if (!row) await new Promise((r) => setTimeout(r, 25));
    }
    expect(row).toBeTruthy();
    expect((row!.after as { method?: string })?.method).toBe('GET');
  });

  it('rate-limits a key with 429 + Retry-After once its budget is exceeded', async () => {
    const created = await request(app).post(api('/api-keys')).set(auth(adminToken)).send({ name: 'rl', role: 'VIEWER' });
    const key: string = created.body.key;
    const prev = process.env.API_KEY_RATE_LIMIT_MAX;
    process.env.API_KEY_RATE_LIMIT_MAX = '2';
    __resetApiKeyRateBuckets();
    try {
      expect((await request(app).get(api('/notifications')).set(auth(key))).status).toBe(200);
      expect((await request(app).get(api('/notifications')).set(auth(key))).status).toBe(200);
      const blocked = await request(app).get(api('/notifications')).set(auth(key));
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    } finally {
      process.env.API_KEY_RATE_LIMIT_MAX = prev;
      __resetApiKeyRateBuckets();
    }
  });
});
