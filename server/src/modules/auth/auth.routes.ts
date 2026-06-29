import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authRateLimit } from '../../middleware/rateLimit.js';
import { changePasswordSchema, loginSchema, refreshSchema, registerSchema } from './auth.schemas.js';
import * as ctrl from './auth.controller.js';

const router = Router();

// Throttle credential endpoints against brute force / stuffing. Only failed
// attempts count toward the limit, so normal logins are unaffected.
const FIFTEEN_MIN = 15 * 60 * 1000;
const loginLimiter = authRateLimit({ windowMs: FIFTEEN_MIN, max: 10, name: 'login' });
const registerLimiter = authRateLimit({ windowMs: FIFTEEN_MIN, max: 10, name: 'register' });
const refreshLimiter = authRateLimit({ windowMs: FIFTEEN_MIN, max: 30, name: 'refresh' });

router.post('/register', registerLimiter, validateBody(registerSchema), asyncHandler(ctrl.registerHandler));
router.post('/login', loginLimiter, validateBody(loginSchema), asyncHandler(ctrl.loginHandler));
router.post('/refresh', refreshLimiter, validateBody(refreshSchema), asyncHandler(ctrl.refreshHandler));
router.get('/me', requireAuth, asyncHandler(ctrl.meHandler));
router.post('/change-password', requireAuth, validateBody(changePasswordSchema), asyncHandler(ctrl.changePasswordHandler));

export default router;
