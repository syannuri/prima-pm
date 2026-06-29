import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';

const app = createApp();
const api = (path: string) => `/api/v1${path}`;
const PW = 'Integration-Test-1';

const tokens: Record<string, string> = {};
let ownerId = '';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function mkUser(name: string, email: string, role: Role) {
  const u = await prisma.user.create({
    data: { name, email, role, passwordHash: await hashPassword(PW), isActive: true },
  });
  tokens[role] = signAccessToken({ sub: u.id, role, email });
  return u;
}

beforeAll(async () => {
  // Wipe the (guarded) test DB so the suite is deterministic.
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }

  await mkUser('Admin', 'admin@test.local', 'ADMIN');
  const owner = await mkUser('Owner PM', 'pm@test.local', 'PROJECT_MANAGER');
  ownerId = owner.id;
  await mkUser('Finance', 'finance@test.local', 'FINANCE');
  await mkUser('Viewer', 'viewer@test.local', 'VIEWER');
  // A second PM (non-owner) — same role key would clash, so store its token separately.
  const pm2 = await prisma.user.create({
    data: { name: 'Other PM', email: 'pm2@test.local', role: 'PROJECT_MANAGER', passwordHash: await hashPassword(PW), isActive: true },
  });
  tokens.PM2 = signAccessToken({ sub: pm2.id, role: 'PROJECT_MANAGER', email: pm2.email });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('auth', () => {
  it('rejects a wrong password with 401', async () => {
    const res = await request(app).post(api('/auth/login')).send({ email: 'pm@test.local', password: 'wrong-password-1' });
    expect(res.status).toBe(401);
  });

  it('accepts the correct password with 200', async () => {
    const res = await request(app).post(api('/auth/login')).send({ email: 'pm@test.local', password: PW });
    expect(res.status).toBe(200);
  });
});

describe('RBAC enforcement (server-side, end-to-end)', () => {
  let projectId = '';

  it('FINANCE cannot create a project (403)', async () => {
    const res = await request(app).post(api('/projects')).set(auth(tokens.FINANCE)).send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('ADMIN can create a project assigned to the owner PM (201)', async () => {
    const res = await request(app)
      .post(api('/projects'))
      .set(auth(tokens.ADMIN))
      .send({ name: 'RBAC Test Project', pmUserId: ownerId });
    expect(res.status).toBe(201);
    projectId = res.body.project.id;
    expect(projectId).toBeTruthy();
  });

  it('a non-owner PM is denied access to the project (403)', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/cost`)).set(auth(tokens.PM2));
    expect(res.status).toBe(403);
  });

  it('the owner PM can read the project cost (200)', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/cost`)).set(auth(tokens.ADMIN));
    expect(res.status).toBe(200);
  });

  it('a VIEWER cannot write project cost (403)', async () => {
    const res = await request(app)
      .post(api(`/projects/${projectId}/cost/direct`))
      .set(auth(tokens.VIEWER))
      .send({ type: 'MANPOWER', planMandays: 1 });
    expect(res.status).toBe(403);
  });

  it('unauthenticated requests are rejected (401)', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/cost`));
    expect(res.status).toBe(401);
  });

  it('a soft-deleted project is 404 on nested routes (S1 regression, end-to-end)', async () => {
    const del = await request(app).delete(api(`/projects/${projectId}`)).set(auth(tokens.ADMIN));
    expect(del.status).toBe(204);

    const read = await request(app).get(api(`/projects/${projectId}/cost`)).set(auth(tokens.ADMIN));
    expect(read.status).toBe(404);

    const write = await request(app)
      .post(api(`/projects/${projectId}/cost/direct`))
      .set(auth(tokens.ADMIN))
      .send({ type: 'MANPOWER', planMandays: 1 });
    expect(write.status).toBe(404);
  });
});
