import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { changePasswordSchema, loginSchema, refreshSchema, registerSchema } from './auth.schemas.js';
import * as ctrl from './auth.controller.js';

const router = Router();

router.post('/register', validateBody(registerSchema), asyncHandler(ctrl.registerHandler));
router.post('/login', validateBody(loginSchema), asyncHandler(ctrl.loginHandler));
router.post('/refresh', validateBody(refreshSchema), asyncHandler(ctrl.refreshHandler));
router.get('/me', requireAuth, asyncHandler(ctrl.meHandler));
router.post('/change-password', requireAuth, validateBody(changePasswordSchema), asyncHandler(ctrl.changePasswordHandler));

export default router;
