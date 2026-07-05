import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { Prisma, type Role } from '@prisma/client';
import { createApp } from '../../app.js';
import { errorHandler } from '../../middleware/error.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { pruneExpiredRefreshTokens } from '../auth/auth.service.js';

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

// Uses a dedicated user so bumping its tokenVersion cannot disturb the RBAC tokens above.
describe('session revocation (tokenVersion)', () => {
  const email = 'revoke@test.local';
  let access = '';
  let refresh = '';

  beforeAll(async () => {
    await prisma.user.create({ data: { name: 'Revoke Me', email, role: 'VIEWER', passwordHash: await hashPassword(PW), isActive: true } });
    const res = await request(app).post(api('/auth/login')).send({ email, password: PW });
    access = res.body.accessToken;
    refresh = res.body.refreshToken;
  });

  it('a fresh session can read /auth/me', async () => {
    const res = await request(app).get(api('/auth/me')).set(auth(access));
    expect(res.status).toBe(200);
  });

  it('logout revokes both the access token and the refresh token', async () => {
    expect((await request(app).post(api('/auth/logout')).set(auth(access))).status).toBe(200);
    // The same access token no longer verifies, and the old refresh token can't mint a new one.
    expect((await request(app).get(api('/auth/me')).set(auth(access))).status).toBe(401);
    expect((await request(app).post(api('/auth/refresh')).send({ refreshToken: refresh })).status).toBe(401);
  });
});

describe('refresh-token rotation (happy path)', () => {
  const email = 'rotate-ok@test.local';
  let r0 = '';

  beforeAll(async () => {
    await prisma.user.create({ data: { name: 'Rotate OK', email, role: 'VIEWER', passwordHash: await hashPassword(PW), isActive: true } });
    r0 = (await request(app).post(api('/auth/login')).send({ email, password: PW })).body.refreshToken;
  });

  it('each refresh mints a NEW refresh token plus a usable access token', async () => {
    const first = await request(app).post(api('/auth/refresh')).send({ refreshToken: r0 });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).toBeTruthy();
    expect(first.body.refreshToken).not.toBe(r0);
    // The freshly rotated access token verifies.
    expect((await request(app).get(api('/auth/me')).set(auth(first.body.accessToken))).status).toBe(200);
    // The rotated-in token keeps working for the next refresh.
    const second = await request(app).post(api('/auth/refresh')).send({ refreshToken: first.body.refreshToken });
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
  });
});

describe('refresh-token reuse detection (theft response)', () => {
  const email = 'rotate-reuse@test.local';
  let r0 = '';
  let r1 = '';

  beforeAll(async () => {
    await prisma.user.create({ data: { name: 'Rotate Reuse', email, role: 'VIEWER', passwordHash: await hashPassword(PW), isActive: true } });
    r0 = (await request(app).post(api('/auth/login')).send({ email, password: PW })).body.refreshToken;
    r1 = (await request(app).post(api('/auth/refresh')).send({ refreshToken: r0 })).body.refreshToken;
  });

  it('replaying a rotated-away token is rejected AND revokes the whole family', async () => {
    // r0 was already rotated into r1 — replaying it signals a leaked/stolen token.
    expect((await request(app).post(api('/auth/refresh')).send({ refreshToken: r0 })).status).toBe(401);
    // The family is now revoked, so even the previously-valid r1 no longer works.
    expect((await request(app).post(api('/auth/refresh')).send({ refreshToken: r1 })).status).toBe(401);
  });
});

describe('expired refresh-token pruning', () => {
  const email = 'prune@test.local';
  let userId = '';

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: 'Prune Me', email, role: 'VIEWER', passwordHash: await hashPassword(PW), isActive: true } });
    userId = u.id;
  });

  it('removes expired rows but keeps still-valid ones (incl. revoked-but-unexpired)', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    // Expired (active) and expired (revoked) — both prunable.
    await prisma.refreshToken.create({ data: { userId, expiresAt: past } });
    await prisma.refreshToken.create({ data: { userId, expiresAt: past, revokedAt: past } });
    // Still valid — must survive.
    const keepValid = await prisma.refreshToken.create({ data: { userId, expiresAt: future } });
    // Revoked but NOT yet expired — kept, still needed for reuse detection.
    const keepRevokedValid = await prisma.refreshToken.create({ data: { userId, expiresAt: future, revokedAt: new Date() } });

    await pruneExpiredRefreshTokens();

    const remaining = await prisma.refreshToken.findMany({ where: { userId }, select: { id: true } });
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(keepValid.id);
    expect(ids).toContain(keepRevokedValid.id);
    expect(remaining).toHaveLength(2);
  });
});

describe('error handler sanitises Prisma P2002', () => {
  it('returns a generic 409 CONFLICT without leaking the offending column name', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['email'] },
    });
    let status = 0;
    let body: { error?: { code?: string; details?: unknown } } = {};
    const res = {
      status(code: number) { status = code; return this; },
      json(payload: typeof body) { body = payload; return this; },
    } as unknown as Response;

    errorHandler(err, {} as Request, res, (() => {}) as NextFunction);

    expect(status).toBe(409);
    expect(body.error?.code).toBe('CONFLICT');
    expect(body.error?.details).toBeUndefined();
    // The internal column name must not appear anywhere in the client payload.
    expect(JSON.stringify(body)).not.toContain('email');
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

  it('rejects a forecast request with an invalid statusDate (400)', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/forecast?statusDate=not-a-date`)).set(auth(tokens.ADMIN));
    expect(res.status).toBe(400);
  });

  it('accepts a forecast request with a valid statusDate (200)', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/forecast?statusDate=2026-10-01`)).set(auth(tokens.ADMIN));
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

describe('CLOSED projects are read-only, reopen is governed', () => {
  let pid = '';
  const addCost = () =>
    request(app).post(api(`/projects/${pid}/cost/direct`)).set(auth(tokens.ADMIN)).send({ type: 'MANPOWER', planMandays: 1 });

  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Closable', pmUserId: ownerId });
    pid = created.body.project.id;
    // DRAFT -> CHARTERED -> CLOSED (no leaf tasks, so the schedule gate is only a warning).
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    const closed = await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CLOSED' });
    expect(closed.status).toBe(200);
    expect(closed.body.project.status).toBe('CLOSED');
  });

  it('blocks nested writes on a CLOSED project (403)', async () => {
    const res = await addCost();
    expect(res.status).toBe(403);
    expect(String(res.body?.error?.message ?? '')).toMatch(/closed|read-only/i);
  });

  it('reopen requires a reason (400 without one)', async () => {
    const res = await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(400);
  });

  it('reopen with a reason restores an editable, in-progress project', async () => {
    const reopen = await request(app)
      .patch(api(`/projects/${pid}`))
      .set(auth(tokens.ADMIN))
      .send({ status: 'IN_PROGRESS', reopenReason: 'Warranty defect — reopening to log the fix.' });
    expect(reopen.status).toBe(200);
    expect(reopen.body.project.status).toBe('IN_PROGRESS');
    expect(reopen.body.project.closedAt).toBeNull();
    // Writes work again.
    expect((await addCost()).status).not.toBe(403);
  });
});

describe('activation gate (planning-baseline checkpoint)', () => {
  const mkChartered = async (name: string) => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name, pmUserId: ownerId });
    const id = created.body.project.id;
    await request(app).patch(api(`/projects/${id}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    return id;
  };
  const activate = (id: string, body: Record<string, unknown> = {}) =>
    request(app).patch(api(`/projects/${id}`)).set(auth(tokens.ADMIN)).send({ status: 'IN_PROGRESS', ...body });

  it('blocks CHARTERED → IN_PROGRESS while the cost baseline is unlocked (400)', async () => {
    const id = await mkChartered('Activate-Blocked');
    const res = await activate(id);
    expect(res.status).toBe(400);
    expect(String(res.body?.error?.message ?? '')).toMatch(/ready to start|baseline/i);
  });

  it('activates once the baseline is locked (200)', async () => {
    const id = await mkChartered('Activate-Ready');
    await request(app).patch(api(`/projects/${id}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });
    const res = await activate(id); // no WBS → schedule baseline is only a warning
    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe('IN_PROGRESS');
  });

  it('force-activate needs a reason (400 without, 200 with)', async () => {
    const id = await mkChartered('Activate-Forced');
    expect((await activate(id, { forceActivate: true })).status).toBe(400);
    const ok = await activate(id, { forceActivate: true, activateReason: 'Sponsor approved starting ahead of baseline lock.' });
    expect(ok.status).toBe(200);
    expect(ok.body.project.status).toBe('IN_PROGRESS');
  });

  // Exposes the readiness checklist for the UI.
  it('GET /activation-readiness returns blockers for an unbaselined project', async () => {
    const id = await mkChartered('Activate-Readiness');
    const res = await request(app).get(api(`/projects/${id}/activation-readiness`)).set(auth(tokens.ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.readiness.canActivate).toBe(false);
    expect(res.body.readiness.blockers.map((b: { key: string }) => b.key)).toContain('baselineLock');
  });
});

describe('baseline lock freezes cost/schedule (PMB/BAC)', () => {
  let pid = '';
  const addCost = () =>
    request(app).post(api(`/projects/${pid}/cost/direct`)).set(auth(tokens.ADMIN)).send({ type: 'HARDWARE_LICENSE', label: 'Server', qty: 1, unitCost: 1000 });
  const setLock = (body: Record<string, unknown>) =>
    request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.ADMIN)).send(body);

  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Lockable', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
  });

  it('cost writes succeed while the baseline is unlocked (201)', async () => {
    expect((await addCost()).status).toBe(201);
  });

  it('locking the baseline blocks cost writes (400)', async () => {
    expect((await setLock({ locked: true })).status).toBe(200);
    const res = await addCost();
    expect(res.status).toBe(400);
    expect(String(res.body?.error?.message ?? '')).toMatch(/baseline is locked/i);
  });

  it('unlocking requires a reason (400 without one)', async () => {
    expect((await setLock({ locked: false })).status).toBe(400);
  });

  it('unlock with a reason re-enables cost writes', async () => {
    expect((await setLock({ locked: false, reason: 'CR-014 approved: added scope.' })).status).toBe(200);
    expect((await addCost()).status).toBe(201);
  });
});

describe('approving a cost/schedule change request unlocks the baseline', () => {
  let pid = '';
  let crId = '';

  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'CR-Baseline', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    // Freeze the baseline, then seed a submitted CR that impacts COST.
    await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });
    const cr = await prisma.changeRequest.create({
      data: { projectId: pid, type: 'COST_BASELINE', title: 'Add reporting scope', description: 'New module', impactAreas: ['COST'], status: 'SUBMITTED', requestedBy: ownerId },
    });
    crId = cr.id;
  });

  it('approval opens the baseline and reports it', async () => {
    const res = await request(app)
      .patch(api(`/projects/${pid}/charter/change-requests/${crId}`))
      .set(auth(tokens.ADMIN))
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.baselineUnlocked).toBe(true);
    // Baseline is now editable again — a cost write succeeds.
    const write = await request(app).post(api(`/projects/${pid}/cost/direct`)).set(auth(tokens.ADMIN)).send({ type: 'HARDWARE_LICENSE', label: 'Reporting srv', qty: 1, unitCost: 5000 });
    expect(write.status).toBe(201);
  });
});
