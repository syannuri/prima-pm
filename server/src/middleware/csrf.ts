import type { Request, Response, NextFunction } from 'express';
import { Forbidden } from '../lib/errors.js';
import { CSRF_COOKIE } from '../lib/cookies.js';

// Methods that don't mutate state don't need CSRF protection.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths (relative to the /api/v1 mount) that are exempt: login has no session cookie yet, so
// there's nothing to double-submit. (Login CSRF is separately mitigated by SameSite=Strict on
// the cookies we set and the app being same-origin.)
const EXEMPT_PATHS = new Set(['/auth/login']);

// Double-submit CSRF guard. Runs on the /api/v1 router. It only applies to browser requests
// that authenticate via the ambient httpOnly cookie — those are forgeable cross-site, so we
// require the caller to echo the JS-readable prima_csrf cookie in an X-CSRF-Token header
// (an attacker on another origin can't read the cookie, so can't set a matching header).
//
// Requests carrying an Authorization: Bearer header are skipped: a header credential is not
// sent automatically by the browser, so it can't be ridden cross-site (this also keeps the
// JWT-mint automation/test workflow working without a CSRF token).
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers['x-csrf-token'];
  // No cookie at all → unauthenticated (or a Bearer-less non-browser client); let the route's
  // own auth reject it with 401 rather than a confusing CSRF 403.
  if (!cookieToken) return next();
  if (typeof headerToken !== 'string' || headerToken !== cookieToken) {
    throw Forbidden('CSRF token missing or invalid');
  }
  next();
}
