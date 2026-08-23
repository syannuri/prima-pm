import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authRateLimit } from '../../middleware/rateLimit.js';
import { verifyCaptcha } from '../../middleware/captcha.js';
import { changePasswordSchema, googleLoginSchema, guestRegisterSchema, loginSchema, orgSignupSchema, refreshSchema, switchTenantSchema, updatePreferencesSchema, verifyEmailSchema, resendActivationSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schemas.js';
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
// Throttle Google sign-in per IP (the email isn't in the request body — it's inside the signed
// token — so IP is the only pre-verification dimension available).
const googleLimiter = authRateLimit({ windowMs: FIFTEEN_MIN, max: 20, name: 'google' });
// Throttle guest signups per IP AND per target email (mirrors login) to blunt bulk abuse of
// the one open-registration path.
const guestLimiter = authRateLimit({
  windowMs: FIFTEEN_MIN,
  max: 10,
  name: 'guest-register',
  keyBy: (req) => {
    const email = (req.body as { email?: unknown })?.email;
    return [typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : undefined];
  },
});

// Throttle activation resends per IP + email so the endpoint can't be used to spam an inbox.
const resendLimiter = authRateLimit({
  windowMs: FIFTEEN_MIN,
  max: 5,
  name: 'resend-activation',
  keyBy: (req) => {
    const email = (req.body as { email?: unknown })?.email;
    return [typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : undefined];
  },
});

// Throttle password-reset requests per IP + email so the endpoint can't spam an inbox or be used to
// probe accounts. Same shape as the activation resend limiter.
const forgotLimiter = authRateLimit({
  windowMs: FIFTEEN_MIN,
  max: 5,
  name: 'forgot-password',
  keyBy: (req) => {
    const email = (req.body as { email?: unknown })?.email;
    return [typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : undefined];
  },
});
// Throttle reset-token redemptions per IP to blunt brute-forcing tokens.
const resetLimiter = authRateLimit({ windowMs: FIFTEEN_MIN, max: 10, name: 'reset-password' });

// Throttle org signups per IP + email (same as guest/login) to blunt bulk tenant creation.
const orgSignupLimiter = authRateLimit({
  windowMs: FIFTEEN_MIN,
  max: 10,
  name: 'org-signup',
  keyBy: (req) => {
    const email = (req.body as { email?: unknown })?.email;
    return [typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : undefined];
  },
});

// Two open signup paths, each gated by its own AppSetting toggle: a sandboxed GUEST (personal
// tenant) and a self-serve ORGANIZATION (corporate tenant + owner admin). Corporate members are
// otherwise ADMIN-provisioned via POST /users or the platform console.
// Public: which sign-in providers this deployment offers (Google client ID, guest + org signup).
router.get('/providers', asyncHandler(ctrl.providersHandler));
// verifyCaptcha runs before validateBody (which strips the raw `captchaToken`); no-op unless
// TURNSTILE_SECRET_KEY is set. Guards the three public forms against bots / bulk abuse.
router.post('/guest/register', guestLimiter, verifyCaptcha, validateBody(guestRegisterSchema), asyncHandler(ctrl.guestRegisterHandler));
router.post('/signup', orgSignupLimiter, verifyCaptcha, validateBody(orgSignupSchema), asyncHandler(ctrl.orgSignupHandler));
router.post('/login', loginLimiter, verifyCaptcha, validateBody(loginSchema), asyncHandler(ctrl.loginHandler));
// Sign in with Google → matches/creates a sandboxed GUEST (gated by GOOGLE_CLIENT_ID).
router.post('/google', googleLimiter, validateBody(googleLoginSchema), asyncHandler(ctrl.googleHandler));
// Email activation (public): redeem a token, or resend a fresh link. Both open (no auth) but throttled.
router.post('/verify-email', validateBody(verifyEmailSchema), asyncHandler(ctrl.verifyEmailHandler));
router.post('/resend-activation', resendLimiter, validateBody(resendActivationSchema), asyncHandler(ctrl.resendActivationHandler));
// Self-service password reset (public): request a link, then redeem the token with a new password.
// forgot-password is captcha-gated (like login/signup) + throttled; both are anti-enumeration.
router.post('/forgot-password', forgotLimiter, verifyCaptcha, validateBody(forgotPasswordSchema), asyncHandler(ctrl.forgotPasswordHandler));
router.post('/reset-password', resetLimiter, validateBody(resetPasswordSchema), asyncHandler(ctrl.resetPasswordHandler));
router.post('/refresh', refreshLimiter, validateBody(refreshSchema), asyncHandler(ctrl.refreshHandler));
router.get('/me', requireAuth, asyncHandler(ctrl.meHandler));
// Tenants the caller belongs to + the active one (for a tenant switcher).
router.get('/tenants', requireAuth, asyncHandler(ctrl.myTenantsHandler));
router.post('/switch-tenant', requireAuth, validateBody(switchTenantSchema), asyncHandler(ctrl.switchTenantHandler));
router.post('/change-password', requireAuth, validateBody(changePasswordSchema), asyncHandler(ctrl.changePasswordHandler));
// Self-service account preferences (emailed alert-digest cadence). Caller updates only their own row.
router.patch('/preferences', requireAuth, validateBody(updatePreferencesSchema), asyncHandler(ctrl.updatePreferencesHandler));
// Logout revokes every outstanding token for the caller (tokenVersion bump).
router.post('/logout', requireAuth, asyncHandler(ctrl.logoutHandler));

export default router;
