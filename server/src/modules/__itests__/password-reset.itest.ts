import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { __setMailSink, type MailMessage } from '../../lib/mailer.js';
import { issuePasswordReset, consumePasswordReset } from '../auth/passwordReset.service.js';

// Self-service password reset — the security-critical properties: anti-enumeration (no signal for
// unknown/ineligible accounts), single-use + expiring hashed tokens, session revocation on reset,
// and OAuth/guest exclusion. Mailer armed → sink; tokens pulled out of the captured reset link.
let captured: MailMessage[] = [];
const resetTokenFrom = (m: MailMessage) => {
  const match = m.text.match(/reset-password\?token=([^\s]+)/);
  if (!match) throw new Error('no reset token in email');
  return decodeURIComponent(match[1]);
};

async function user(email: string, opts: { password?: string | null; active?: boolean } = {}) {
  return prisma.user.create({
    data: {
      name: 'PR ' + email, email, role: 'PROJECT_MANAGER',
      passwordHash: opts.password === null ? null : await hashPassword(opts.password ?? 'Original-Pass-1'),
      isActive: opts.active ?? true,
    },
  });
}

describe('password reset', () => {
  beforeAll(() => {
    process.env.SMTP_HOST = 'smtp.test'; process.env.MAIL_FROM = 'Prismatix <no-reply@test>';
    __setMailSink((m) => captured.push(m));
  });
  afterAll(() => { __setMailSink(null); delete process.env.SMTP_HOST; delete process.env.MAIL_FROM; });
  beforeEach(async () => {
    captured = [];
    await prisma.emailToken.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'pr-' } } });
  });

  it('issues a single-use reset link, resets the password, revokes sessions, and confirms by email', async () => {
    const u = await user('pr-a@corp.test', { password: 'Original-Pass-1' });
    await prisma.refreshToken.create({ data: { id: 'jti-pr-a', userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) } });

    await issuePasswordReset('pr-a@corp.test');
    const mail = captured.find((m) => m.to === 'pr-a@corp.test' && m.subject.includes('Reset your'));
    expect(mail).toBeTruthy();
    const token = resetTokenFrom(mail!);
    expect(await prisma.emailToken.count({ where: { userId: u.id, purpose: 'PASSWORD_RESET', consumedAt: null } })).toBe(1);

    captured = [];
    await consumePasswordReset(token, 'Brand-New-Pass-9');

    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(await verifyPassword('Brand-New-Pass-9', after!.passwordHash)).toBe(true); // new password works
    expect(after!.tokenVersion).toBe(u.tokenVersion + 1); // all sessions invalidated
    expect((await prisma.refreshToken.findUnique({ where: { id: 'jti-pr-a' } }))!.revokedAt).not.toBeNull();
    expect((await prisma.emailToken.findFirst({ where: { userId: u.id } }))!.consumedAt).not.toBeNull(); // single-use
    expect(captured.some((m) => m.to === 'pr-a@corp.test' && m.subject.includes('was changed'))).toBe(true); // confirmation
  });

  it('rejects reuse of a spent token (single-use)', async () => {
    const u = await user('pr-b@corp.test');
    await issuePasswordReset('pr-b@corp.test');
    const token = resetTokenFrom(captured.find((m) => m.subject.includes('Reset your'))!);
    await consumePasswordReset(token, 'Brand-New-Pass-9');
    await expect(consumePasswordReset(token, 'Another-Pass-9')).rejects.toThrow();
    void u;
  });

  it('rejects an expired token and a wrong-purpose token', async () => {
    const u = await user('pr-c@corp.test');
    const { createHash } = await import('node:crypto');
    const mk = async (raw: string, purpose: 'PASSWORD_RESET' | 'VERIFY_EMAIL', expiresAt: Date) =>
      prisma.emailToken.create({ data: { userId: u.id, tokenHash: createHash('sha256').update(raw).digest('hex'), purpose, expiresAt } });
    await mk('expired-tok', 'PASSWORD_RESET', new Date(Date.now() - 1000));
    await mk('wrong-purpose-tok', 'VERIFY_EMAIL', new Date(Date.now() + 86_400_000));
    await expect(consumePasswordReset('expired-tok', 'Brand-New-Pass-9')).rejects.toThrow();
    await expect(consumePasswordReset('wrong-purpose-tok', 'Brand-New-Pass-9')).rejects.toThrow();
    await expect(consumePasswordReset('never-existed', 'Brand-New-Pass-9')).rejects.toThrow();
  });

  it('anti-enumeration: no email / token for unknown, OAuth-only, or inactive accounts', async () => {
    await user('pr-oauth@corp.test', { password: null }); // OAuth/guest — no local password
    await user('pr-inactive@corp.test', { active: false });

    await issuePasswordReset('nobody@corp.test');       // unknown
    await issuePasswordReset('pr-oauth@corp.test');     // no passwordHash
    await issuePasswordReset('pr-inactive@corp.test');  // deactivated

    expect(captured).toHaveLength(0); // nothing sent
    expect(await prisma.emailToken.count({ where: { purpose: 'PASSWORD_RESET' } })).toBe(0); // no token minted
  });
});
