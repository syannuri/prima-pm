import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { __resetSettingsCache } from '../../modules/settings/settings.service.js';
import { __setMailSink, type MailMessage } from '../../lib/mailer.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Email activation / HARD verification wall (Phase 2). The wall is armed only when SMTP is configured
// (emailEnabled()), so this suite sets SMTP_HOST + MAIL_FROM to arm it and routes every send to a sink
// so nothing hits the network. A separate case unsets SMTP to prove the disarmed (current) behaviour.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;

let captured: MailMessage[] = [];
let prevHost: string | undefined;
let prevFrom: string | undefined;

const enableGuestSignup = async (on: boolean) => {
  await runAsSystem(() =>
    prisma.appSetting.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', guestSignupEnabled: on },
      update: { guestSignupEnabled: on },
    }),
  );
  __resetSettingsCache();
};

const armEmail = () => {
  process.env.SMTP_HOST = 'smtp.test';
  process.env.MAIL_FROM = 'Prismatix <no-reply@test>';
};
const disarmEmail = () => {
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
};

// Pull the raw activation token out of the /verify-email link inside a captured email.
const tokenFrom = (m: MailMessage): string => {
  const match = m.text.match(/verify-email\?token=([^\s]+)/);
  if (!match) throw new Error('no activation token in email: ' + m.text);
  return decodeURIComponent(match[1]);
};

const guestRegister = (email: string) =>
  request(app).post(api('/auth/guest/register')).send({ name: 'Guest User', email, password: 'Guest-Pass-1' });
const login = (email: string) => request(app).post(api('/auth/login')).send({ email, password: 'Guest-Pass-1' });

beforeAll(async () => {
  prevHost = process.env.SMTP_HOST;
  prevFrom = process.env.MAIL_FROM;
  await wipeDb();
  await backfillDefaultTenant(prisma);
  await enableGuestSignup(true);
  __setMailSink((m) => captured.push(m));
});

beforeEach(() => {
  captured = [];
});

afterAll(() => {
  __setMailSink(null);
  if (prevHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = prevHost;
  if (prevFrom === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = prevFrom;
  __resetSettingsCache();
});

describe('email armed → HARD verification wall', () => {
  beforeAll(armEmail);

  it('guest signup does NOT auto-login: 202 verify marker, no cookie, unverified user, activation email sent', async () => {
    const res = await guestRegister('wall@test.dev');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ verify: true, email: 'wall@test.dev' });
    expect(res.headers['set-cookie']).toBeUndefined(); // no session established
    const user = await runAsSystem(() => prisma.user.findUnique({ where: { email: 'wall@test.dev' }, select: { emailVerifiedAt: true } }));
    expect(user?.emailVerifiedAt).toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe('wall@test.dev');
    expect(captured[0].subject).toMatch(/activate/i);
  });

  it('login is blocked with EMAIL_NOT_VERIFIED until the token is redeemed, then succeeds', async () => {
    await guestRegister('flow@test.dev');
    const token = tokenFrom(captured[0]);

    const blocked = await login('flow@test.dev');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const verify = await request(app).post(api('/auth/verify-email')).send({ token });
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ ok: true, email: 'flow@test.dev' });

    const ok = await login('flow@test.dev');
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
  });

  it('a spent token is rejected (single-use) and a garbage token is a 400', async () => {
    await guestRegister('once@test.dev');
    const token = tokenFrom(captured[0]);
    await request(app).post(api('/auth/verify-email')).send({ token }).expect(200);
    await request(app).post(api('/auth/verify-email')).send({ token }).expect(400); // already consumed
    await request(app).post(api('/auth/verify-email')).send({ token: 'not-a-real-token' }).expect(400);
  });

  it('resend issues a fresh link for an unverified account, but is a silent no-op once verified', async () => {
    await guestRegister('resend@test.dev');
    captured = [];
    await request(app).post(api('/auth/resend-activation')).send({ email: 'resend@test.dev' }).expect(200);
    expect(captured).toHaveLength(1);
    const token = tokenFrom(captured[0]);
    await request(app).post(api('/auth/verify-email')).send({ token }).expect(200);
    captured = [];
    // Already verified → generic 200, no email leaked.
    await request(app).post(api('/auth/resend-activation')).send({ email: 'resend@test.dev' }).expect(200);
    expect(captured).toHaveLength(0);
  });
});

describe('email disarmed → current behaviour preserved', () => {
  beforeAll(disarmEmail);

  it('guest signup auto-logs-in (201 + token) and the account is born verified; no email sent', async () => {
    const res = await guestRegister('off@test.dev');
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    const user = await runAsSystem(() => prisma.user.findUnique({ where: { email: 'off@test.dev' }, select: { emailVerifiedAt: true } }));
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(captured).toHaveLength(0);
    await login('off@test.dev').expect(200); // login works without any verification step
  });
});
