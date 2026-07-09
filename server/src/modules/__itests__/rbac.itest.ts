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

// Parse a supertest response's Set-Cookie array into { name: { value, attrs } }.
function parseSetCookie(res: request.Response): Record<string, { value: string; attrs: string }> {
  const out: Record<string, { value: string; attrs: string }> = {};
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  for (const c of raw ?? []) {
    const [pair, ...rest] = c.split('; ');
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attrs: rest.join('; ') };
  }
  return out;
}

describe('cookie auth + CSRF (double-submit)', () => {
  const email = 'cookie@test.local';
  let jar: Record<string, { value: string; attrs: string }> = {};

  beforeAll(async () => {
    await prisma.user.create({ data: { name: 'Cookie Admin', email, role: 'ADMIN', passwordHash: await hashPassword(PW), isActive: true } });
    const res = await request(app).post(api('/auth/login')).send({ email, password: PW });
    jar = parseSetCookie(res);
  });

  it('login sets httpOnly access + refresh cookies and a JS-readable CSRF cookie', () => {
    expect(jar.prima_at?.value).toBeTruthy();
    expect(jar.prima_at.attrs).toMatch(/HttpOnly/i);
    expect(jar.prima_at.attrs).toMatch(/SameSite=Strict/i);
    expect(jar.prima_rt?.value).toBeTruthy();
    expect(jar.prima_rt.attrs).toMatch(/HttpOnly/i);
    // The CSRF token must be readable by JS (no HttpOnly) so the SPA can echo it in a header.
    expect(jar.prima_csrf?.value).toBeTruthy();
    expect(jar.prima_csrf.attrs).not.toMatch(/HttpOnly/i);
  });

  it('authenticates a GET with only the access cookie (no Bearer header)', async () => {
    const res = await request(app).get(api('/auth/me')).set('Cookie', `prima_at=${jar.prima_at.value}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it('rejects a cookie-authed mutation with NO X-CSRF-Token (403)', async () => {
    const res = await request(app)
      .post(api('/projects'))
      .set('Cookie', `prima_at=${jar.prima_at.value}; prima_csrf=${jar.prima_csrf.value}`)
      .send({ name: 'CSRF-less', pmUserId: ownerId });
    expect(res.status).toBe(403);
    expect(String(res.body?.error?.message ?? '')).toMatch(/csrf/i);
  });

  it('rejects a cookie-authed mutation whose X-CSRF-Token does not match the cookie (403)', async () => {
    const res = await request(app)
      .post(api('/projects'))
      .set('Cookie', `prima_at=${jar.prima_at.value}; prima_csrf=${jar.prima_csrf.value}`)
      .set('X-CSRF-Token', 'not-the-cookie-value')
      .send({ name: 'CSRF-mismatch', pmUserId: ownerId });
    expect(res.status).toBe(403);
  });

  it('accepts a cookie-authed mutation when the X-CSRF-Token matches the cookie (201)', async () => {
    const res = await request(app)
      .post(api('/projects'))
      .set('Cookie', `prima_at=${jar.prima_at.value}; prima_csrf=${jar.prima_csrf.value}`)
      .set('X-CSRF-Token', jar.prima_csrf.value)
      .send({ name: 'CSRF-ok', pmUserId: ownerId });
    expect(res.status).toBe(201);
  });

  it('a Bearer-authed mutation is exempt from CSRF (no header needed)', async () => {
    const res = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Bearer-no-csrf', pmUserId: ownerId });
    expect(res.status).toBe(201);
  });

  it('refresh via the cookie rotates the session and re-sets the cookies', async () => {
    const res = await request(app)
      .post(api('/auth/refresh'))
      .set('Cookie', `prima_rt=${jar.prima_rt.value}; prima_csrf=${jar.prima_csrf.value}`)
      .set('X-CSRF-Token', jar.prima_csrf.value);
    expect(res.status).toBe(200);
    const rotated = parseSetCookie(res);
    expect(rotated.prima_at?.value).toBeTruthy();
    expect(rotated.prima_rt?.value).toBeTruthy();
    expect(rotated.prima_rt.value).not.toBe(jar.prima_rt.value); // rotated to a new refresh token
  });

  it('logout clears the auth cookies (Max-Age=0 / Expires in the past)', async () => {
    const res = await request(app).post(api('/auth/logout')).set('Cookie', `prima_at=${jar.prima_at.value}; prima_csrf=${jar.prima_csrf.value}`).set('X-CSRF-Token', jar.prima_csrf.value);
    expect(res.status).toBe(200);
    const cleared = parseSetCookie(res);
    // clearCookie emits an expiry in the past for each cookie.
    expect(cleared.prima_at.attrs).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    expect(cleared.prima_rt.attrs).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
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

describe('manpower → task Owner prefill (only when the task has no owner)', () => {
  let pid = '';
  let resourceId = '';
  let otherResourceId = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'MP-Owner', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    resourceId = (await prisma.resource.create({ data: { name: 'Backend Eng' } })).id;
    otherResourceId = (await prisma.resource.create({ data: { name: 'Someone Else' } })).id;
  });

  const addTask = async (name: string) => {
    const res = await request(app).post(api(`/projects/${pid}/schedule/tasks`)).set(auth(tokens.ADMIN)).send({ name, planStart: '2026-08-01', planEnd: '2026-08-10' });
    return res.body.task.id as string;
  };
  const addManpower = (taskId: string, rid: string) =>
    request(app).post(api(`/projects/${pid}/cost/direct`)).set(auth(tokens.ADMIN)).send({ type: 'MANPOWER', planMandays: 2, resourceId: rid, taskId });

  it('sets the task Owner from a linked manpower resource when the task has none', async () => {
    const taskId = await addTask('Build API');
    expect((await addManpower(taskId, resourceId)).status).toBe(201);
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { picResourceId: true } });
    expect(task?.picResourceId).toBe(resourceId);
  });

  it('does NOT overwrite an existing task Owner', async () => {
    const taskId = await addTask('Design DB');
    await prisma.task.update({ where: { id: taskId }, data: { picResourceId: otherResourceId } });
    expect((await addManpower(taskId, resourceId)).status).toBe(201);
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { picResourceId: true } });
    expect(task?.picResourceId).toBe(otherResourceId); // unchanged
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

describe('closing artifacts (lessons learned + acceptance sign-off)', () => {
  let pid = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Closeout-Project', pmUserId: ownerId });
    pid = created.body.project.id;
  });

  it('the owning PM can log a lesson and a sign-off; both list back', async () => {
    const lesson = await request(app).post(api(`/projects/${pid}/closeout/lessons`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ category: 'WENT_WELL', title: 'Daily standups kept scope tight', description: 'Repeat next time.' });
    expect(lesson.status).toBe(201);

    const signoff = await request(app).post(api(`/projects/${pid}/closeout/acceptances`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ party: 'Sponsor', decision: 'ACCEPTED', signedByName: 'Dewi Sponsor' });
    expect(signoff.status).toBe(201);

    const lessons = await request(app).get(api(`/projects/${pid}/closeout/lessons`)).set(auth(tokens.PROJECT_MANAGER));
    expect(lessons.body.lessons).toHaveLength(1);
    expect(lessons.body.lessons[0].createdByName).toBe('Owner PM'); // FK-less id resolved to a name

    const accs = await request(app).get(api(`/projects/${pid}/closeout/acceptances`)).set(auth(tokens.PROJECT_MANAGER));
    expect(accs.body.acceptances).toHaveLength(1);
    expect(accs.body.acceptances[0].decision).toBe('ACCEPTED');
  });

  it('VIEWER cannot write closing artifacts (403) but a non-owner PM is denied too (403)', async () => {
    const viewer = await request(app).post(api(`/projects/${pid}/closeout/lessons`)).set(auth(tokens.VIEWER))
      .send({ category: 'WENT_WRONG', title: 'nope' });
    expect(viewer.status).toBe(403);
    const otherPm = await request(app).post(api(`/projects/${pid}/closeout/lessons`)).set(auth(tokens.PM2))
      .send({ category: 'WENT_WRONG', title: 'nope' });
    expect(otherPm.status).toBe(403);
  });

  it('closure readiness flips the lessons/acceptance warnings once artifacts exist', async () => {
    // Fresh project → both artifacts missing → both warnings present.
    const fresh = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Closeout-Fresh', pmUserId: ownerId });
    const fid = fresh.body.project.id;
    const before = await request(app).get(api(`/projects/${fid}/closure-readiness`)).set(auth(tokens.ADMIN));
    const warnKeys = (before.body.readiness.warnings as { key: string }[]).map((w) => w.key);
    expect(warnKeys).toContain('lessons');
    expect(warnKeys).toContain('acceptance');

    // The one on `pid` already has both → those two warnings are gone.
    const after = await request(app).get(api(`/projects/${pid}/closure-readiness`)).set(auth(tokens.ADMIN));
    const items = after.body.readiness.items as { key: string; ok: boolean }[];
    expect(items.find((i) => i.key === 'lessons')?.ok).toBe(true);
    expect(items.find((i) => i.key === 'acceptance')?.ok).toBe(true);
  });

  it('a REJECTED sign-off does not satisfy the acceptance check', async () => {
    const rej = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Closeout-Rejected', pmUserId: ownerId });
    const rid = rej.body.project.id;
    await request(app).post(api(`/projects/${rid}/closeout/acceptances`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ party: 'Customer', decision: 'REJECTED', comments: 'Deliverable returned' });
    const readiness = await request(app).get(api(`/projects/${rid}/closure-readiness`)).set(auth(tokens.ADMIN));
    const items = readiness.body.readiness.items as { key: string; ok: boolean }[];
    expect(items.find((i) => i.key === 'acceptance')?.ok).toBe(false);
  });
});

describe('guided next-step cues', () => {
  const nextSteps = (id: string) => request(app).get(api(`/projects/${id}/next-steps`)).set(auth(tokens.ADMIN));

  it('DRAFT project → the cue is to commit the charter', async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Cue-Draft', pmUserId: ownerId });
    const res = await nextSteps(created.body.project.id);
    expect(res.status).toBe(200);
    expect(res.body.nextSteps.steps.map((s: { key: string }) => s.key)).toEqual(['commitCharter']);
  });

  it('advances CHARTERED → lock baseline → activate as the state changes', async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Cue-Flow', pmUserId: ownerId });
    const id = created.body.project.id;
    await request(app).patch(api(`/projects/${id}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });

    // No WBS + unlocked baseline → lock the baseline first.
    const chartered = await nextSteps(id);
    expect(chartered.body.nextSteps.steps.map((s: { key: string }) => s.key)).toEqual(['lockBaseline']);

    // Lock it → activation-ready (no WBS → schedule baseline is only a warning) → activate.
    await request(app).patch(api(`/projects/${id}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });
    const ready = await nextSteps(id);
    expect(ready.body.nextSteps.steps.map((s: { key: string }) => s.key)).toEqual(['activate']);
  });

  it('IN_PROGRESS with no plan → closeout cues (record acceptance, capture lessons, close)', async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Cue-InProgress', pmUserId: ownerId });
    const id = created.body.project.id;
    await request(app).patch(api(`/projects/${id}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    await request(app).patch(api(`/projects/${id}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });
    await request(app).patch(api(`/projects/${id}`)).set(auth(tokens.ADMIN)).send({ status: 'IN_PROGRESS' });

    // No WBS/backlog → closure has no schedule blocker → the guide moves to closeout.
    const res = await nextSteps(id);
    expect(res.body.nextSteps.steps.map((s: { key: string }) => s.key)).toEqual(['recordAcceptance', 'captureLessons', 'closeProject']);
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

  it('the owning PM (who builds the cost breakdown) can lock AND unlock their own baseline', async () => {
    const lock = await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.PROJECT_MANAGER)).send({ locked: true });
    expect(lock.status).toBe(200);
    const unlock = await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.PROJECT_MANAGER)).send({ locked: false, reason: 'PM re-opening to revise the estimate' });
    expect(unlock.status).toBe(200);
  });

  it('a non-owner PM and FINANCE cannot lock the baseline (403)', async () => {
    const otherPm = await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.PM2)).send({ locked: true });
    expect(otherPm.status).toBe(403);
    // FINANCE may write cost lines but the baseline freeze is a PM/PMO governance act.
    const finance = await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.FINANCE)).send({ locked: true });
    expect(finance.status).toBe(403);
  });
});

describe('baseline lock ordering guard (WBS projects must capture the schedule baseline first)', () => {
  let pid = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Order-Guard', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    // Build a WBS but do NOT capture the schedule baseline yet.
    await request(app).post(api(`/projects/${pid}/schedule/tasks`)).set(auth(tokens.ADMIN)).send({ name: 'Design', planStart: '2026-08-01', planEnd: '2026-08-15' });
  });

  it('blocks locking while a WBS project has no schedule baseline (400)', async () => {
    const res = await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });
    expect(res.status).toBe(400);
    expect(String(res.body?.error?.message ?? '')).toMatch(/capture the schedule baseline/i);
  });

  it('allows locking once the schedule baseline is captured (200)', async () => {
    expect((await request(app).post(api(`/projects/${pid}/schedule/baseline`)).set(auth(tokens.ADMIN))).status).toBe(200);
    const res = await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });
    expect(res.status).toBe(200);
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

describe('CR rework: the declared affected area drives the unlock', () => {
  it('approving a SCHEDULE change request opens the baseline so the WBS becomes editable', async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'CR-Schedule', pmUserId: ownerId });
    const pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });

    // While locked, a WBS write is frozen.
    const blocked = await request(app).post(api(`/projects/${pid}/schedule/tasks`)).set(auth(tokens.ADMIN)).send({ name: 'T', planStart: '2026-08-01', planEnd: '2026-08-08' });
    expect(blocked.status).toBe(400);

    // A change request declaring SCHEDULE, once approved, opens the baseline (not just COST).
    const cr = await prisma.changeRequest.create({
      data: { projectId: pid, type: 'SCHEDULE', title: 'Rename a WBS task', description: 'WBS edit', impactAreas: ['SCHEDULE'], status: 'SUBMITTED', requestedBy: ownerId },
    });
    const res = await request(app).patch(api(`/projects/${pid}/charter/change-requests/${cr.id}`)).set(auth(tokens.ADMIN)).send({ decision: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.baselineUnlocked).toBe(true);

    // Now the WBS write succeeds — the exact flow that was broken.
    const task = await request(app).post(api(`/projects/${pid}/schedule/tasks`)).set(auth(tokens.ADMIN)).send({ name: 'New WBS task', planStart: '2026-08-01', planEnd: '2026-08-08' });
    expect(task.status).toBe(201);
  });
});

describe('EVM trend snapshots (capture / list / trend / delete + RBAC)', () => {
  let pid = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'EVM-Trend-Project', pmUserId: ownerId });
    pid = created.body.project.id;
  });

  it('the owning PM captures a snapshot; it lists back with the capturer name and derived EVM fields', async () => {
    const cap = await request(app).post(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ statusDate: '2026-03-31', note: 'End of Q1 status' });
    expect(cap.status).toBe(201);
    expect(cap.body.snapshot).toMatchObject({ note: 'End of Q1 status' });

    const list = await request(app).get(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.PROJECT_MANAGER));
    expect(list.body.snapshots).toHaveLength(1);
    expect(list.body.snapshots[0].createdByName).toBe('Owner PM'); // FK-less id resolved to a name
    expect(list.body.snapshots[0]).toHaveProperty('cpi');
    expect(list.body.snapshots[0]).toHaveProperty('spi');
  });

  it('re-capturing the same status date upserts (not a duplicate row)', async () => {
    const again = await request(app).post(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ statusDate: '2026-03-31', note: 'Corrected Q1 status' });
    expect(again.status).toBe(201);
    const list = await request(app).get(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.PROJECT_MANAGER));
    expect(list.body.snapshots).toHaveLength(1); // still one — same (project, statusDate)
    expect(list.body.snapshots[0].note).toBe('Corrected Q1 status');
  });

  it('the trend endpoint returns the captured series + a planned-curve backdrop + BAC', async () => {
    const trend = await request(app).get(api(`/projects/${pid}/evm/trend?statusDate=2026-06-30`)).set(auth(tokens.FINANCE));
    expect(trend.status).toBe(200); // FINANCE reads alongside the owner
    expect(trend.body.snapshots).toHaveLength(1);
    expect(trend.body).toHaveProperty('bac');
    expect(Array.isArray(trend.body.plannedCurve)).toBe(true);
  });

  it('a bad ?statusDate= is rejected 400 (coerced, not NaN)', async () => {
    const bad = await request(app).get(api(`/projects/${pid}/evm/trend?statusDate=not-a-date`)).set(auth(tokens.ADMIN));
    expect(bad.status).toBe(400);
  });

  it('VIEWER and a non-owner PM cannot capture (403); the owner can delete', async () => {
    const viewer = await request(app).post(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.VIEWER)).send({});
    expect(viewer.status).toBe(403);
    const otherPm = await request(app).post(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.PM2)).send({});
    expect(otherPm.status).toBe(403);

    const list = await request(app).get(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.PROJECT_MANAGER));
    const id = list.body.snapshots[0].id;
    const del = await request(app).delete(api(`/projects/${pid}/evm/snapshots/${id}`)).set(auth(tokens.PROJECT_MANAGER));
    expect(del.status).toBe(204);
    const after = await request(app).get(api(`/projects/${pid}/evm/snapshots`)).set(auth(tokens.PROJECT_MANAGER));
    expect(after.body.snapshots).toHaveLength(0);
  });
});

describe('portfolio EVM trend (capture-all + rolled-up series + RBAC)', () => {
  let a = '';
  let b = '';
  beforeAll(async () => {
    // Two chartered projects owned by the PM so capture-all (non-DRAFT filter) picks them up.
    for (const name of ['Portfolio-Trend-A', 'Portfolio-Trend-B']) {
      const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name, pmUserId: ownerId });
      await request(app).patch(api(`/projects/${created.body.project.id}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
      if (name.endsWith('A')) a = created.body.project.id; else b = created.body.project.id;
    }
  });

  it('ADMIN capture-all snapshots every visible non-DRAFT project; the trend rolls them up', async () => {
    const cap = await request(app).post(api('/portfolio/evm/capture-all')).set(auth(tokens.ADMIN)).send({ statusDate: '2026-04-30' });
    expect(cap.status).toBe(201);
    expect(cap.body.captured).toBeGreaterThanOrEqual(2); // at least A and B

    const trend = await request(app).get(api('/portfolio/evm/trend')).set(auth(tokens.ADMIN));
    expect(trend.status).toBe(200);
    expect(Array.isArray(trend.body.series)).toBe(true);
    expect(trend.body.series.length).toBeGreaterThanOrEqual(1);
    expect(trend.body.projectCount).toBeGreaterThanOrEqual(2);
    // Both A and B now carry a snapshot at the shared date.
    expect(await request(app).get(api(`/projects/${a}/evm/snapshots`)).set(auth(tokens.ADMIN)).then((r) => r.body.snapshots.length)).toBeGreaterThanOrEqual(1);
    expect(await request(app).get(api(`/projects/${b}/evm/snapshots`)).set(auth(tokens.ADMIN)).then((r) => r.body.snapshots.length)).toBeGreaterThanOrEqual(1);
  });

  it('VIEWER cannot capture-all (403); a PM can but is scoped to owned projects', async () => {
    const viewer = await request(app).post(api('/portfolio/evm/capture-all')).set(auth(tokens.VIEWER)).send({});
    expect(viewer.status).toBe(403);

    // PM2 owns nothing → capture-all touches 0 projects (allowed, but empty).
    const pm2 = await request(app).post(api('/portfolio/evm/capture-all')).set(auth(tokens.PM2)).send({ statusDate: '2026-05-31' });
    expect(pm2.status).toBe(201);
    expect(pm2.body.total).toBe(0);
    const pm2Trend = await request(app).get(api('/portfolio/evm/trend')).set(auth(tokens.PM2));
    expect(pm2Trend.body.projectCount).toBe(0);
  });
});

describe('project code auto-numbering is collision-safe (max + 1, not count)', () => {
  it('generates the next code from the highest existing sequence, skipping gaps/soft-deletes', async () => {
    const year = new Date().getFullYear();
    // Seed an explicit high code, leaving a large gap below it (count-based numbering
    // would generate a low code that ignores this max).
    const explicit = await request(app).post(api('/projects')).set(auth(tokens.ADMIN))
      .send({ name: 'High Code', code: `PRJ-${year}-9000`, pmUserId: ownerId });
    expect(explicit.status).toBe(201);

    // Auto-numbered create must land ABOVE the max (9001) — not reuse a lower code.
    const auto = await request(app).post(api('/projects')).set(auth(tokens.ADMIN))
      .send({ name: 'Auto Code', pmUserId: ownerId });
    expect(auto.status).toBe(201);
    expect(auto.body.project.code).toBe(`PRJ-${year}-9001`);

    // Soft-deleting the top code must NOT let the next create reuse it (code stays globally unique).
    await request(app).delete(api(`/projects/${auto.body.project.id}`)).set(auth(tokens.ADMIN));
    const after = await request(app).post(api('/projects')).set(auth(tokens.ADMIN))
      .send({ name: 'After Delete', pmUserId: ownerId });
    expect(after.status).toBe(201);
    expect(after.body.project.code).toBe(`PRJ-${year}-9002`);
  });
});

describe('activation-ready notification (baselines complete → tell ADMIN/PMO)', () => {
  let pid = '';
  const readyInbox = async () => {
    const inbox = await request(app).get(api('/notifications/inbox')).set(auth(tokens.ADMIN));
    return (inbox.body.items as { type: string; projectId: string }[]).filter((n) => n.type === 'ACTIVATION_READY' && n.projectId === pid);
  };
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Notify-Ready', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
  });

  it('notifies ADMIN when the owning PM locks the baseline and the project becomes activation-ready', async () => {
    expect(await readyInbox()).toHaveLength(0); // nothing yet
    // No WBS → the schedule baseline is only a warning, so locking the cost baseline completes the set.
    const lock = await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.PROJECT_MANAGER)).send({ locked: true });
    expect(lock.status).toBe(200);
    expect(await readyInbox()).toHaveLength(1); // ADMIN got the "ready to activate" alert (actor was the PM)
  });

  it('fires only once — unlocking then re-locking does not re-notify', async () => {
    await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.PROJECT_MANAGER)).send({ locked: false, reason: 'revise estimate' });
    await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.PROJECT_MANAGER)).send({ locked: true });
    expect(await readyInbox()).toHaveLength(1); // still one (guarded by activationReadyNotifiedAt)
  });

  it('the project surfaces in the ADMIN/PMO "awaiting activation" dashboard queue, not for a PM', async () => {
    // pid (from the block above) is chartered + baseline locked + no WBS → activation-ready.
    const admin = await request(app).get(api('/portfolio/awaiting-activation')).set(auth(tokens.ADMIN));
    expect(admin.status).toBe(200);
    expect((admin.body.items as { id: string }[]).some((x) => x.id === pid)).toBe(true);

    // A PM does not hold the activation gate → the queue is empty for them.
    const pm = await request(app).get(api('/portfolio/awaiting-activation')).set(auth(tokens.PROJECT_MANAGER));
    expect(pm.body.count).toBe(0);
  });
});

describe('WBS templates (list + apply to seed an empty schedule)', () => {
  let pid = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Template-Project', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
  });

  it('lists the curated templates', async () => {
    const res = await request(app).get(api(`/projects/${pid}/schedule/templates`)).set(auth(tokens.PROJECT_MANAGER));
    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThanOrEqual(3);
    expect(res.body.templates.map((t: { id: string }) => t.id)).toContain('cloud-migration');
  });

  it('applies a template to seed the WBS, then blocks a second apply', async () => {
    const apply = await request(app).post(api(`/projects/${pid}/schedule/apply-template`)).set(auth(tokens.PROJECT_MANAGER)).send({ templateId: 'server-migration', startDate: '2026-09-01' });
    expect(apply.status).toBe(201);
    expect(apply.body.created).toBe(10);
    const sched = await request(app).get(api(`/projects/${pid}/schedule`)).set(auth(tokens.PROJECT_MANAGER));
    expect(sched.body.tasks.length).toBe(10);
    // a second apply is rejected — templates only seed an empty schedule
    const again = await request(app).post(api(`/projects/${pid}/schedule/apply-template`)).set(auth(tokens.PROJECT_MANAGER)).send({ templateId: 'server-migration' });
    expect(again.status).toBe(400);
  });

  it('a VIEWER cannot apply (403); an unknown template is 404', async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Template-RBAC', pmUserId: ownerId });
    const p2 = created.body.project.id;
    await request(app).patch(api(`/projects/${p2}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    expect((await request(app).post(api(`/projects/${p2}/schedule/apply-template`)).set(auth(tokens.VIEWER)).send({ templateId: 'generic-it' })).status).toBe(403);
    expect((await request(app).post(api(`/projects/${p2}/schedule/apply-template`)).set(auth(tokens.ADMIN)).send({ templateId: 'nope' })).status).toBe(404);
  });
});

describe('Kick-Off meeting (details + attendees + action items + RBAC)', () => {
  let pid = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Kickoff-Project', pmUserId: ownerId });
    pid = created.body.project.id;
  });

  it('GET returns an empty shape before anything is created', async () => {
    const res = await request(app).get(api(`/projects/${pid}/kickoff`)).set(auth(tokens.PROJECT_MANAGER));
    expect(res.status).toBe(200);
    expect(res.body.meeting).toBeNull();
    expect(res.body.attendees).toEqual([]);
    expect(res.body.actionItems).toEqual([]);
  });

  it('the owning PM upserts details, adds an attendee & an action item; all list back', async () => {
    const put = await request(app).put(api(`/projects/${pid}/kickoff`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ facilitator: 'Rina', location: 'Online (Teams)', agenda: '1. Scope 2. Plan' });
    expect(put.status).toBe(200);
    expect(put.body.meeting.facilitator).toBe('Rina');

    const at = await request(app).post(api(`/projects/${pid}/kickoff/attendees`)).set(auth(tokens.PROJECT_MANAGER)).send({ name: 'Budi', role: 'Sponsor' });
    expect(at.status).toBe(201);
    const ac = await request(app).post(api(`/projects/${pid}/kickoff/actions`)).set(auth(tokens.PROJECT_MANAGER)).send({ description: 'Share network diagram', ownerName: 'Cahya' });
    expect(ac.status).toBe(201);

    const get = await request(app).get(api(`/projects/${pid}/kickoff`)).set(auth(tokens.ADMIN));
    expect(get.body.meeting.createdByName).toBe('Owner PM'); // FK-less id resolved
    expect(get.body.attendees).toHaveLength(1);
    expect(get.body.actionItems).toHaveLength(1);

    // toggle attendee present + close the action item
    await request(app).patch(api(`/projects/${pid}/kickoff/attendees/${at.body.attendee.id}`)).set(auth(tokens.PROJECT_MANAGER)).send({ present: false });
    const done = await request(app).patch(api(`/projects/${pid}/kickoff/actions/${ac.body.actionItem.id}`)).set(auth(tokens.PROJECT_MANAGER)).send({ status: 'DONE' });
    expect(done.body.actionItem.status).toBe('DONE');
  });

  it('VIEWER, FINANCE and a non-owner PM cannot write/read (403); delete cascades', async () => {
    expect((await request(app).post(api(`/projects/${pid}/kickoff/attendees`)).set(auth(tokens.VIEWER)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).put(api(`/projects/${pid}/kickoff`)).set(auth(tokens.PM2)).send({ facilitator: 'x' })).status).toBe(403);
    expect((await request(app).get(api(`/projects/${pid}/kickoff`)).set(auth(tokens.FINANCE))).status).toBe(403);

    const get = await request(app).get(api(`/projects/${pid}/kickoff`)).set(auth(tokens.ADMIN));
    const del = await request(app).delete(api(`/projects/${pid}/kickoff/attendees/${get.body.attendees[0].id}`)).set(auth(tokens.PROJECT_MANAGER));
    expect(del.status).toBe(204);
    const after = await request(app).get(api(`/projects/${pid}/kickoff`)).set(auth(tokens.ADMIN));
    expect(after.body.attendees).toHaveLength(0);
  });
});

describe('UAT test cases (create / execute / summary / RBAC)', () => {
  let pid = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'UAT-Project', pmUserId: ownerId });
    pid = created.body.project.id;
  });

  it('the owning PM creates test cases (auto-coded) and they list with a summary', async () => {
    const a = await request(app).post(api(`/projects/${pid}/uat`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ title: 'Login with valid credentials', scenario: 'Active account', steps: '1. open 2. submit', expected: 'Dashboard shown' });
    expect(a.status).toBe(201);
    expect(a.body.testCase.code).toBe('UAT-001');
    const b = await request(app).post(api(`/projects/${pid}/uat`)).set(auth(tokens.PROJECT_MANAGER)).send({ title: 'Wrong password', expected: 'Error shown' });
    expect(b.body.testCase.code).toBe('UAT-002');

    const list = await request(app).get(api(`/projects/${pid}/uat`)).set(auth(tokens.PROJECT_MANAGER));
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0].createdByName).toBe('Owner PM'); // FK-less id resolved
    expect(list.body.summary).toMatchObject({ total: 2, notRun: 2, pass: 0, executed: 0, passRate: 0 });
  });

  it('recording a PASS/FAIL updates status, auto-stamps executedAt, and moves the pass rate', async () => {
    const list = await request(app).get(api(`/projects/${pid}/uat`)).set(auth(tokens.PROJECT_MANAGER));
    const [a, b] = list.body.items;
    const passed = await request(app).patch(api(`/projects/${pid}/uat/${a.id}`)).set(auth(tokens.PROJECT_MANAGER)).send({ status: 'PASS', testerName: 'Rina' });
    expect(passed.status).toBe(200);
    expect(passed.body.testCase.status).toBe('PASS');
    expect(passed.body.testCase.executedAt).toBeTruthy(); // auto-stamped
    await request(app).patch(api(`/projects/${pid}/uat/${b.id}`)).set(auth(tokens.PROJECT_MANAGER)).send({ status: 'FAIL', notes: 'DEF-9' });

    const after = await request(app).get(api(`/projects/${pid}/uat`)).set(auth(tokens.PROJECT_MANAGER));
    expect(after.body.summary).toMatchObject({ total: 2, executed: 2, pass: 1, fail: 1, passRate: 50 });
  });

  it('VIEWER and a non-owner PM cannot write (403); the owner can delete', async () => {
    const viewer = await request(app).post(api(`/projects/${pid}/uat`)).set(auth(tokens.VIEWER)).send({ title: 'x', expected: 'y' });
    expect(viewer.status).toBe(403);
    const otherPm = await request(app).post(api(`/projects/${pid}/uat`)).set(auth(tokens.PM2)).send({ title: 'x', expected: 'y' });
    expect(otherPm.status).toBe(403);
    const finance = await request(app).get(api(`/projects/${pid}/uat`)).set(auth(tokens.FINANCE));
    expect(finance.status).toBe(403); // UAT is a delivery artifact — not the finance domain

    const list = await request(app).get(api(`/projects/${pid}/uat`)).set(auth(tokens.ADMIN));
    const del = await request(app).delete(api(`/projects/${pid}/uat/${list.body.items[0].id}`)).set(auth(tokens.PROJECT_MANAGER));
    expect(del.status).toBe(204);
    const remaining = await request(app).get(api(`/projects/${pid}/uat`)).set(auth(tokens.ADMIN));
    expect(remaining.body.items).toHaveLength(1);
  });
});

describe('project status report (weekly/monthly, PM + ADMIN/PMO)', () => {
  let pid = '';
  beforeAll(async () => {
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Report-Project', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
  });

  it('returns the curated report (meta, evm, task breakdown, forecast) for the owning PM', async () => {
    const res = await request(app).get(api(`/projects/${pid}/report?period=weekly`)).set(auth(tokens.PROJECT_MANAGER));
    expect(res.status).toBe(200);
    expect(res.body.project.code).toBeTruthy();
    expect(res.body.period).toBe('weekly');
    expect(res.body.periodLabel).toMatch(/Week ending/);
    expect(res.body).toHaveProperty('health');
    expect(res.body.tasks).toHaveProperty('weightedPct');
    expect(res.body.tasks).toHaveProperty('completed');
    expect(res.body.forecast).toHaveProperty('eac');
    expect(Array.isArray(res.body.forecast.sCurve)).toBe(true);
  });

  it('monthly period yields a month label', async () => {
    const res = await request(app).get(api(`/projects/${pid}/report?period=monthly`)).set(auth(tokens.ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('monthly');
    expect(res.body.periodLabel).not.toMatch(/Week ending/);
  });

  it('rejects a bad period (400) and denies FINANCE / a non-owner PM (403)', async () => {
    // daily/weekly/monthly/yearly are all valid now; only an off-enum value is rejected.
    expect((await request(app).get(api(`/projects/${pid}/report?period=hourly`)).set(auth(tokens.ADMIN))).status).toBe(400);
    expect((await request(app).get(api(`/projects/${pid}/report`)).set(auth(tokens.FINANCE))).status).toBe(403);
    expect((await request(app).get(api(`/projects/${pid}/report`)).set(auth(tokens.PM2))).status).toBe(403);
  });

  it('serves a PDF for the report', async () => {
    const res = await request(app).get(api(`/projects/${pid}/report/pdf?period=weekly`)).set(auth(tokens.PROJECT_MANAGER));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/status_report\.pdf/);
  });
});

describe('awaiting-closure queue (delivery complete → tell ADMIN/PMO to close)', () => {
  let pid = '';
  const inQueue = async (token: string) => {
    const res = await request(app).get(api('/portfolio/awaiting-closure')).set(auth(token));
    return res.body as { items: { id: string; hasAcceptance: boolean; hasLessons: boolean }[]; count: number };
  };
  beforeAll(async () => {
    // Chartered → baseline locked → activated. No WBS/backlog, so the schedule gate is only
    // a warning → the project is closure-ready the moment it's in execution.
    const created = await request(app).post(api('/projects')).set(auth(tokens.ADMIN)).send({ name: 'Closable-Ready', pmUserId: ownerId });
    pid = created.body.project.id;
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'CHARTERED' });
    await request(app).patch(api(`/projects/${pid}/baseline-lock`)).set(auth(tokens.ADMIN)).send({ locked: true });
    await request(app).patch(api(`/projects/${pid}`)).set(auth(tokens.ADMIN)).send({ status: 'IN_PROGRESS' });
  });

  it('surfaces a closure-ready project to ADMIN with both closeout artifacts still pending', async () => {
    const q = await inQueue(tokens.ADMIN);
    const item = q.items.find((i) => i.id === pid);
    expect(item).toBeTruthy();
    expect(item!.hasAcceptance).toBe(false);
    expect(item!.hasLessons).toBe(false);
  });

  it('flips the acceptance chip once a sign-off is recorded', async () => {
    await request(app).post(api(`/projects/${pid}/closeout/acceptances`)).set(auth(tokens.PROJECT_MANAGER))
      .send({ party: 'Sponsor', decision: 'ACCEPTED', signedByName: 'Dewi Sponsor' });
    const item = (await inQueue(tokens.ADMIN)).items.find((i) => i.id === pid);
    expect(item!.hasAcceptance).toBe(true); // still listed (canClose), now with acceptance done
  });

  it('is empty for a PM — closing is an ADMIN/PMO gate', async () => {
    expect((await inQueue(tokens.PROJECT_MANAGER)).count).toBe(0);
  });
});
