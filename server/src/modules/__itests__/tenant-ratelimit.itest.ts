import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Per-tenant throughput rate limit (Phase 5). Enforcement ON, with a tiny budget so a few requests
// trip it — and one tenant hitting its limit must NOT affect another (per-tenant isolation).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let prevMax: string | undefined;
let tokenA = '', tokenB = '';

async function mkTenant(slug: string): Promise<string> {
  const t = await prisma.tenant.create({ data: { slug, name: slug } });
  const u = await prisma.user.create({ data: { name: slug, email: `${slug}@rl.test`, role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: u.id, tenantId: t.id, role: 'ADMIN' } });
  return signAccessToken({ sub: u.id, role: 'ADMIN', email: u.email, tv: 0, tid: t.id });
}

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevMax = process.env.TENANT_RATE_LIMIT_MAX;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.TENANT_RATE_LIMIT_MAX = '3'; // 3 requests / window / tenant
  await wipeDb();
  tokenA = await mkTenant('rl-a');
  tokenB = await mkTenant('rl-b');
});

afterAll(() => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevMax === undefined) delete process.env.TENANT_RATE_LIMIT_MAX; else process.env.TENANT_RATE_LIMIT_MAX = prevMax;
});

describe('per-tenant rate limit', () => {
  it('blocks a tenant with 429 once it exceeds its budget, isolated from other tenants', async () => {
    // First `max` requests pass, the next is throttled (429 + Retry-After).
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get(api('/projects')).set(bearer(tokenA))).status).toBe(200);
    }
    const over = await request(app).get(api('/projects')).set(bearer(tokenA));
    expect(over.status).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();

    // Tenant B has its own budget — unaffected by A hitting the wall.
    expect((await request(app).get(api('/projects')).set(bearer(tokenB))).status).toBe(200);
  });
});
