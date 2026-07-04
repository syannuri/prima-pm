import type { Role, User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { Unauthorized } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import type { ChangePasswordInput, LoginInput } from './auth.schemas.js';

interface AuthResult {
  user: { id: string; name: string; email: string; role: Role };
  accessToken: string;
  refreshToken: string;
}

function toAuthResult(user: User): AuthResult {
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email, tv: user.tokenVersion }),
    refreshToken: signRefreshToken(user.id, user.tokenVersion),
  };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Constant-ish failure to avoid user enumeration.
  if (!user || !user.isActive) throw Unauthorized('Invalid credentials');

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw Unauthorized('Invalid credentials');

  await writeAudit({ userId: user.id, entity: 'User', entityId: user.id, action: 'LOGIN' });
  return toAuthResult(user);
}

export async function refresh(refreshToken: string): Promise<{ accessToken: string }> {
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

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email, tv: user.tokenVersion }),
  };
}

// Changing the password revokes every other outstanding session (tokenVersion bump) and
// returns a fresh token pair so the CALLER's current session continues seamlessly.
export async function changePassword(userId: string, input: ChangePasswordInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Unauthorized();

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw Unauthorized('Current password is incorrect');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.newPassword), tokenVersion: { increment: 1 } },
  });
  await writeAudit({ userId, entity: 'User', entityId: userId, action: 'PASSWORD_CHANGE' });
  return toAuthResult(updated);
}

// Log out everywhere: bump tokenVersion so all currently-issued tokens for this user
// stop verifying on the next request.
export async function logoutAll(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
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
