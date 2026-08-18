import { describe, it, expect, afterEach } from 'vitest';
import {
  emailEnabled,
  mailFrom,
  appBaseUrl,
  sendMail,
  __setMailSink,
  __resetMailTransport,
  type MailMessage,
} from '../mailer.js';
import { verifyEmailMail, orgApprovedMail, orgSignupAdminAlertMail } from '../mail/templates.js';

// Snapshot + restore the env keys these tests poke so they don't leak between cases / suites.
const KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'APP_URL', 'CORS_ORIGIN'] as const;
const prev: Record<string, string | undefined> = {};
for (const k of KEYS) prev[k] = process.env[k];
afterEach(() => {
  for (const k of KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k]!;
  }
  __setMailSink(null);
  __resetMailTransport();
});

describe('emailEnabled (dormant gate)', () => {
  it('is false with no SMTP config', () => {
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    delete process.env.SMTP_USER;
    expect(emailEnabled()).toBe(false);
  });
  it('needs both a host and a from-address (or SMTP user)', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    delete process.env.MAIL_FROM;
    delete process.env.SMTP_USER;
    expect(emailEnabled()).toBe(false);
    process.env.MAIL_FROM = 'no-reply@example.com';
    expect(emailEnabled()).toBe(true);
  });
});

describe('sendMail', () => {
  it('routes to the sink when set, without SMTP', async () => {
    const seen: MailMessage[] = [];
    __setMailSink((m) => seen.push(m));
    const r = await sendMail({ to: 'a@b.com', subject: 'Hi', html: '<b>hi</b>', text: 'hi' });
    expect(r.delivered).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].to).toBe('a@b.com');
  });
  it('is a no-op (delivered:false) when email is disabled and no sink', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    delete process.env.SMTP_USER;
    const r = await sendMail({ to: 'a@b.com', subject: 'Hi', html: 'x', text: 'x' });
    expect(r.delivered).toBe(false);
  });
});

describe('mailFrom / appBaseUrl', () => {
  it('appBaseUrl prefers APP_URL and trims trailing slash', () => {
    process.env.APP_URL = 'https://prismatix.tech/';
    expect(appBaseUrl()).toBe('https://prismatix.tech');
  });
  it('appBaseUrl falls back to the first CORS origin', () => {
    delete process.env.APP_URL;
    process.env.CORS_ORIGIN = 'https://a.example.com, https://b.example.com';
    expect(appBaseUrl()).toBe('https://a.example.com');
  });
  it('mailFrom falls back to the SMTP user', () => {
    delete process.env.MAIL_FROM;
    process.env.SMTP_USER = 'ops@example.com';
    expect(mailFrom()).toBe('ops@example.com');
  });
});

describe('templates', () => {
  it('verifyEmailMail embeds a /verify-email link carrying the token', () => {
    process.env.APP_URL = 'https://prismatix.tech';
    const m = verifyEmailMail({ name: 'Budi', token: 'tok+123' });
    const url = 'https://prismatix.tech/verify-email?token=tok%2B123';
    expect(m.html).toContain(url);
    expect(m.text).toContain(url);
    expect(m.html).toContain('Budi');
    expect(m.subject).toMatch(/aktivasi/i);
  });
  it('orgApprovedMail names the org and carries the login url', () => {
    const m = orgApprovedMail({ name: 'Sinta', orgName: 'Acme', loginUrl: 'https://acme.prismatix.tech/login' });
    expect(m.subject).toContain('Acme');
    expect(m.html).toContain('https://acme.prismatix.tech/login');
  });
  it('orgSignupAdminAlertMail links to the console approval queue', () => {
    process.env.APP_URL = 'https://prismatix.tech';
    const m = orgSignupAdminAlertMail({ orgName: 'Acme' });
    expect(m.html).toContain('https://prismatix.tech/admin/tenants');
    expect(m.subject).toContain('Acme');
  });
});
