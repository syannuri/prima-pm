import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { BadRequest } from '../../lib/errors.js';
import { sendMail, emailEnabled } from '../../lib/mailer.js';
import { passwordResetMail, passwordChangedMail } from '../../lib/mail/templates.js';
import { hashPassword } from '../../lib/password.js';
import { writeAudit } from '../../lib/audit.js';

// Reset links live 30 minutes — long enough to open the email, short enough to bound replay of a
// leaked inbox for a sensitive action. Only the token HASH is stored (see EmailToken); the raw token
// exists solely in the emailed URL, so a DB leak can't be replayed.
const TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Request a reset. ANTI-ENUMERATION: the caller ALWAYS gets the same response regardless of whether
// the email exists / is eligible — this function just quietly does nothing when it shouldn't send.
// Only sends when the account exists, is active, and has a LOCAL password; OAuth/guest accounts have
// no passwordHash (they authenticate via their provider), so a reset would be meaningless. No-op when
// email delivery is disabled.
export async function issuePasswordReset(email: string): Promise<void> {
  if (!emailEnabled()) return;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, email: true, isActive: true, passwordHash: true },
  });
  if (!user || !user.isActive || !user.passwordHash) return;
  const raw = randomBytes(32).toString('base64url');
  await prisma.emailToken.create({
    data: { userId: user.id, tokenHash: hashToken(raw), purpose: 'PASSWORD_RESET', expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  await sendMail({ to: user.email, ...passwordResetMail({ name: user.name, token: raw }) });
}

// Redeem a reset token: set the new password, revoke EVERY session (bump tokenVersion + revoke
// refresh tokens), consume this + any other outstanding reset tokens for the user (single-use), and
// send a change-confirmation email. Deliberately does NOT issue a session — the user signs in with
// the new password. An invalid / expired / spent token (or an inactive user) is a 400. Public route;
// User + EmailToken are global models so this is safe outside a tenant scope.
export async function consumePasswordReset(rawToken: string, newPassword: string): Promise<void> {
  if (!rawToken) throw BadRequest('Missing reset token.');
  const row = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  if (!row || row.purpose !== 'PASSWORD_RESET' || row.consumedAt || row.expiresAt < new Date() || !row.user.isActive) {
    throw BadRequest('This reset link is invalid or has expired. Request a new one.');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } }),
    prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    // Consume THIS token plus any other pending reset tokens for the user, so a link can't be reused
    // and a second in-flight request can't also reset.
    prisma.emailToken.updateMany({ where: { userId: row.userId, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: new Date() } }),
  ]);
  await writeAudit({ userId: row.userId, entity: 'User', entityId: row.userId, action: 'PASSWORD_RESET' });
  await sendMail({ to: row.user.email, ...passwordChangedMail({ name: row.user.name }) });
}
