import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authRateLimit } from '../../middleware/rateLimit.js';
import { changePasswordSchema, loginSchema, refreshSchema } from './auth.schemas.js';
import * as ctrl from './auth.controller.js';

const router = Router();

// Throttle credential endpoints against brute force / stuffing. Only failed
// attempts count toward the limit, so normal logins are unaffected.
const FIFTEEN_MIN = 15 * 60 * 1000;
// Login throttles per IP AND per target email, so a distributed attack on one account is
// caught even across rotating IPs. The email is read from the raw body (this runs before
// validation) and normalised to match the login schema's lowercasing.
const loginLimiter = authRateLimit({
  windowMs: FIFTEEN_MIN,
  max: 10,
  name: 'login',
  keyBy: (req) => {
    const email = (req.body as { email?: unknown })?.email;
    return [typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : undefined];
  },
});
const refreshLimiter = authRateLimit({ windowMs: FIFTEEN_MIN, max: 30, name: 'refresh' });

// Open self-registration is intentionally disabled: this is an internal app and
// accounts are provisioned by an ADMIN via POST /users. There is no public signup.
router.post('/login', loginLimiter, validateBody(loginSchema), asyncHandler(ctrl.loginHandler));
router.post('/refresh', refreshLimiter, validateBody(refreshSchema), asyncHandler(ctrl.refreshHandler));
router.get('/me', requireAuth, asyncHandler(ctrl.meHandler));
router.post('/change-password', requireAuth, validateBody(changePasswordSchema), asyncHandler(ctrl.changePasswordHandler));
// Logout revokes every outstanding token for the caller (tokenVersion bump).
router.post('/logout', requireAuth, asyncHandler(ctrl.logoutHandler));

export default router;
