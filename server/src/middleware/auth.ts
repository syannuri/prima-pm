import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt.js';
import { Unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { AT_COOKIE } from '../lib/cookies.js';

// Authenticated user attached to the request by requireAuth.
export interface AuthUser {
  id: string;
  role: Role;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Verifies the Bearer access token AND revalidates the account against the DB on every
// request: the user must still exist and be active, and the token's version must match
// User.tokenVersion (so logout / password change / deactivation revoke tokens immediately).
// Role is taken from the DB, not the token, so role changes take effect at once.
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    // Prefer the Authorization header (used by automation / the JWT-mint test workflow);
    // fall back to the httpOnly prima_at cookie (the browser SPA's credential — kept out of
    // JS so an XSS can't read it).
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : req.cookies?.[AT_COOKIE];
    if (!token) throw Unauthorized('Missing authentication');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw Unauthorized('Invalid or expired access token');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, email: true, isActive: true, tokenVersion: true },
    });
    if (!user || !user.isActive) throw Unauthorized('Session is no longer valid');
    if ((payload.tv ?? 0) !== user.tokenVersion) throw Unauthorized('Session has been revoked');

    req.user = { id: user.id, role: user.role, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}
