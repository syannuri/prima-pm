import { randomBytes, createHash } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest } from '../../lib/errors.js';
import { sendMail, emailEnabled } from '../../lib/mailer.js';
import { verifyEmailMail } from '../../lib/mail/templates.js';

// Activation links live 24h. Short enough to bound replay of a leaked inbox, long enough to be humane.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Only the hash is persisted (see EmailToken); the raw token exists solely in the emailed URL.
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Verification timestamp a NEW local account is born with: null (unverified → must activate) ONLY when
// email is armed; otherwise `now` so a mail-less deployment never locks anyone out. Provider sign-ins
// (Google/Microsoft) are pre-verified by the provider and set their own timestamp, not this.
export function initialEmailVerifiedAt(): Date | null {
  return emailEnabled() ? null : new Date();
}

// Mint a single-use activation token and email the /verify-email link. Best-effort delivery — the
// caller must not let a mail failure break signup (sendMail itself never throws).
export async function issueActivationEmail(user: Pick<User, 'id' | 'name' | 'email'>): Promise<void> {
  const raw = randomBytes(32).toString('base64url');
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      purpose: 'VERIFY_EMAIL',
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  await sendMail({ to: user.email, ...verifyEmailMail({ name: user.name, token: raw }) });
}

// Redeem an activation token: mark it consumed + stamp the account verified (first verify wins). A
// spent / expired / unknown token is a 400. Public route (no tenant context); User + EmailToken are
// global models so this is safe outside a tenant scope.
export async function consumeActivationToken(raw: string): Promise<{ email: string }> {
  if (!raw) throw BadRequest('Missing activation token.');
  const row = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
  });
  if (!row || row.purpose !== 'VERIFY_EMAIL' || row.consumedAt || row.expiresAt < new Date()) {
    throw BadRequest('This activation link is invalid or has expired. Request a new one.');
  }
  await prisma.$transaction([
    prisma.emailToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() },
    }),
  ]);
  return { email: row.user.email };
}

// Resend activation for an unverified account. ALWAYS resolves the same way regardless of whether the
// email exists / is already verified (no user enumeration — the route also throttles). No-op when
// email delivery is disabled.
export async function resendActivation(email: string): Promise<void> {
  if (!emailEnabled()) return;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) return;
  await issueActivationEmail(user);
}
