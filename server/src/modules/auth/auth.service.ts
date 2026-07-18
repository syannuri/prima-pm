import { randomUUID } from 'node:crypto';
import type { Role, User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { Unauthorized, Forbidden, Conflict } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { verifyGoogleIdToken } from '../../lib/google.js';
import { isGuestSignupEnabled, isGoogleLoginEnabled } from '../settings/settings.service.js';
import type { ChangePasswordInput, GuestRegisterInput, LoginInput } from './auth.schemas.js';

interface AuthResult {
  user: { id: string; name: string; email: string; role: Role };
  accessToken: string;
  refreshToken: string;
}

// Issue a fresh access token + a NEW tracked refresh token (a RefreshToken row keyed by
// the token's jti). Optionally records that it replaces a rotated-away token.
async function issueTokenPair(user: User, replacesJti?: string): Promise<AuthResult> {
  const jti = randomUUID();
  const { token: refreshToken, expiresAt } = signRefreshToken(user.id, user.tokenVersion, jti);
  await prisma.$transaction(async (tx) => {
    if (replacesJti) {
      await tx.refreshToken.update({
        where: { id: replacesJti },
        data: { revokedAt: new Date(), replacedById: jti },
      });
    }
    await tx.refreshToken.create({ data: { id: jti, userId: user.id, expiresAt } });
  });
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email, tv: user.tokenVersion }),
    refreshToken,
  };
}

// Delete refresh-token rows whose JWT has already expired. Safe because an expired token is
// rejected on verify anyway, so its row can no longer take part in reuse detection. Rows that
// are REVOKED but not yet expired are KEPT — they're still needed to catch replay of a leaked
// token inside its validity window. Returns the number of rows removed.
export async function pruneExpiredRefreshTokens(): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

// Revoke EVERY session for a user: bump tokenVersion (kills all access + refresh tokens on
// next use) and mark all outstanding refresh-token rows revoked. Used on logout, password
// change/reset, and as the theft response when a rotated refresh token is replayed.
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Constant-ish failure to avoid user enumeration.
  if (!user || !user.isActive) throw Unauthorized('Invalid credentials');

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw Unauthorized('Invalid credentials');

  await writeAudit({ userId: user.id, entity: 'User', entityId: user.id, action: 'LOGIN' });
  return issueTokenPair(user);
}

// Self-service guest signup. The ONLY open-registration path — hard-codes role GUEST (a guest
// is sandboxed to their own personal projects) and is gated behind GUEST_SIGNUP_ENABLED so a
// deployment must opt in. Auto-logs in on success (returns a token pair like login).
export async function guestRegister(input: GuestRegisterInput): Promise<AuthResult> {
  if (!(await isGuestSignupEnabled())) throw Forbidden('Guest signup is not enabled');
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw Conflict('That email is already registered');
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: 'GUEST',
    },
  });
  await writeAudit({ userId: user.id, entity: 'User', entityId: user.id, action: 'CREATE', after: { email: user.email, role: 'GUEST', self: true } });
  return issueTokenPair(user);
}

// "Sign in with Google" — the open, sandboxed jalur: any Google account may sign in, and a
// first-time user is auto-provisioned as a GUEST (same sandbox as guest signup). SECURITY: to
// stop a Google-email collision from hijacking a staff account, Google only ever manages GUEST
// accounts — if the verified email already belongs to a NON-guest (staff) user, we refuse and
// tell them to use their password. Existing accounts match by the stable Google `sub` first,
// then (first link) by email. Gated by GOOGLE_CLIENT_ID.
export async function loginWithGoogle(credential: string): Promise<AuthResult> {
  if (!(await isGoogleLoginEnabled())) throw Forbidden('Google sign-in is not enabled');

  let identity;
  try {
    identity = await verifyGoogleIdToken(credential);
  } catch {
    throw Unauthorized('Invalid Google token');
  }
  if (!identity.emailVerified) throw Unauthorized('Your Google account email is not verified');

  // 1) Already linked to this Google identity → that account.
  const bySub = await prisma.user.findUnique({ where: { googleSub: identity.sub } });
  if (bySub) {
    if (!bySub.isActive) throw Unauthorized('This account is deactivated');
    await writeAudit({ userId: bySub.id, entity: 'User', entityId: bySub.id, action: 'LOGIN', after: { via: 'google' } });
    return issueTokenPair(bySub);
  }

  // 2) An account with this email exists but isn't linked yet.
  const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
  if (byEmail) {
    // Google manages only GUEST accounts — never let it authenticate into a staff account.
    if (byEmail.role !== 'GUEST') throw Forbidden('This email belongs to a staff account — sign in with your password.');
    if (!byEmail.isActive) throw Unauthorized('This account is deactivated');
    const linked = await prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: identity.sub } });
    await writeAudit({ userId: linked.id, entity: 'User', entityId: linked.id, action: 'LOGIN', after: { via: 'google', linked: true } });
    return issueTokenPair(linked);
  }

  // 3) First-time Google user → provision a sandboxed GUEST (no local password).
  const created = await prisma.user.create({
    data: { name: identity.name, email: identity.email, googleSub: identity.sub, passwordHash: null, role: 'GUEST' },
  });
  await writeAudit({ userId: created.id, entity: 'User', entityId: created.id, action: 'CREATE', after: { email: created.email, role: 'GUEST', via: 'google', self: true } });
  return issueTokenPair(created);
}

// Rotating refresh: verify the presented token, then swap it for a brand-new pair. The old
// token is revoked, so a client must always use the newest one. Replaying an already-revoked
// token means it leaked (a legit client never reuses a rotated token) → revoke the whole
// session family. Tokens minted before rotation shipped have no jti — those are accepted once
// and upgraded to a tracked, rotating token (no forced logout on deploy).
export async function refresh(refreshToken: string): Promise<AuthResult> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Unauthorized('Invalid or expired refresh token');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw Unauthorized('User no longer active');
  // Reject refresh tokens minted before the user's sessions were revoked.
  if ((payload.tv ?? 0) !== user.tokenVersion) throw Unauthorized('Session has been revoked');

  if (payload.jti) {
    const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!stored || stored.userId !== user.id || stored.expiresAt.getTime() < Date.now()) {
      throw Unauthorized('Invalid or expired refresh token');
    }
    if (stored.revokedAt) {
      // Reuse of a rotated/revoked token → treat as theft and kill every session.
      await revokeAllSessions(user.id);
      throw Unauthorized('Session has been revoked');
    }
    return issueTokenPair(user, payload.jti);
  }

  // Legacy (pre-rotation) token: nothing to rotate away, just mint a tracked pair.
  return issueTokenPair(user);
}

// Changing the password revokes every other outstanding session (tokenVersion bump + refresh
// rows revoked) and returns a fresh token pair so the CALLER's current session continues.
export async function changePassword(userId: string, input: ChangePasswordInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Unauthorized();

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw Unauthorized('Current password is incorrect');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.newPassword), tokenVersion: { increment: 1 } },
  });
  // Revoke all previously-issued refresh tokens (other sessions), then mint a fresh one below.
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ userId, entity: 'User', entityId: userId, action: 'PASSWORD_CHANGE' });
  return issueTokenPair(updated);
}

// Log out everywhere: bump tokenVersion and revoke every outstanding refresh token so all
// currently-issued tokens for this user stop working on the next request.
export async function logoutAll(userId: string): Promise<void> {
  await revokeAllSessions(userId);
  await writeAudit({ userId, entity: 'User', entityId: userId, action: 'LOGOUT' });
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });
  if (!user) throw Unauthorized();
  return user;
}
