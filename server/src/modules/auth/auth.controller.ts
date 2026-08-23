import type { Request, Response } from 'express';
import * as authService from './auth.service.js';
import * as verificationService from './verification.service.js';
import * as passwordResetService from './passwordReset.service.js';
import { setAuthCookies, clearAuthCookies, RT_COOKIE } from '../../lib/cookies.js';
import { Unauthorized } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { getAppSettings, isGoogleConfigured } from '../settings/settings.service.js';
import { captchaEnabled } from '../../lib/turnstile.js';
import { emailEnabled } from '../../lib/mailer.js';
import { readCountry, captureUserCountry } from '../../lib/geo.js';

// Public auth config so the SPA can render provider buttons without a rebuild. The Google
// client ID is not a secret (it ships in the browser). Reflects the EFFECTIVE (admin-toggled)
// state: Google is on only when a client ID is configured AND the admin has enabled it.
export async function providersHandler(req: Request, res: Response): Promise<void> {
  const s = await getAppSettings();
  res.json({
    google: { enabled: isGoogleConfigured() && s.googleLoginEnabled, clientId: env.googleClientId },
    // Turnstile CAPTCHA on the public forms. The site key is public (renders the widget); enabled
    // reflects whether the server will verify (TURNSTILE_SECRET_KEY set).
    turnstile: { enabled: captchaEnabled(), siteKey: env.turnstile.siteKey },
    guestSignup: s.guestSignupEnabled,
    orgSignup: s.orgSignupEnabled,
    // Whether email delivery is configured — the SPA only offers self-service "Forgot password?" when
    // a reset email can actually be sent (else it keeps the "ask your admin" fallback).
    emailEnabled: emailEnabled(),
    // When this Host maps to a workspace (subdomain / custom domain), the SPA brands the login page
    // for it and scopes sign-in to that tenant. Null on the bare base domain / LAN-by-IP.
    workspace: req.hostTenant ? { slug: req.hostTenant.slug, name: req.hostTenant.name, status: req.hostTenant.status } : null,
    // The Host is a workspace-shaped subdomain that owns no tenant → SPA shows "workspace not found".
    workspaceNotFound: Boolean(req.hostWorkspaceMissing),
  });
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body, { hostTenantId: req.hostTenant?.id });
  // Set the httpOnly auth cookies for the browser SPA; the body still carries the tokens
  // for Bearer/automation clients (backward compatible).
  setAuthCookies(res, result);
  void captureUserCountry(result.user.id, readCountry(req)); // best-effort geo backfill
  res.json(result);
}

export async function guestRegisterHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.guestRegister(req.body);
  // HARD email-verification wall armed (SMTP configured): no auto-login — the account must be
  // activated from the emailed link first. 202 (accepted, not yet actioned) with a verify marker.
  if ('verify' in result) {
    res.status(202).json(result);
    return;
  }
  setAuthCookies(res, result); // auto-login on signup (email wall disarmed)
  void captureUserCountry(result.user.id, readCountry(req));
  res.status(201).json(result);
}

export async function orgSignupHandler(req: Request, res: Response): Promise<void> {
  // Option C: no auto-login. The tenant is created PENDING and must be approved by a platform admin
  // before the owner can sign in. Return 202 (accepted, not yet actioned) with a pending marker.
  const result = await authService.registerOrg(req.body, readCountry(req));
  res.status(202).json(result);
}

export async function verifyEmailHandler(req: Request, res: Response): Promise<void> {
  // Redeem the activation token (from the emailed link). Success flips the account to verified; the
  // client then routes to /login. We deliberately DON'T auto-login: an org owner may still be pending
  // approval, and keeping it a plain confirm keeps the edge cases out.
  const raw = (req.body?.token ?? req.query?.token ?? '') as string;
  const result = await verificationService.consumeActivationToken(raw);
  res.json({ ok: true, ...result });
}

export async function resendActivationHandler(req: Request, res: Response): Promise<void> {
  // Always 200 with the same shape regardless of whether the email exists / is already verified —
  // no user enumeration. The route throttles by IP + email.
  await verificationService.resendActivation(String(req.body?.email ?? ''));
  res.json({ ok: true });
}

export async function forgotPasswordHandler(req: Request, res: Response): Promise<void> {
  // Always 200 with the same shape regardless of whether the email exists / is eligible — no user
  // enumeration. The route throttles by IP + email; the service is a no-op when email is off.
  await passwordResetService.issuePasswordReset(String(req.body?.email ?? ''));
  res.json({ ok: true });
}

export async function resetPasswordHandler(req: Request, res: Response): Promise<void> {
  // Redeem the reset token + set the new password (revokes all sessions). NO auto-login by design —
  // the client routes to /login so the user signs in with the new password.
  await passwordResetService.consumePasswordReset(String(req.body?.token ?? ''), String(req.body?.newPassword ?? ''));
  res.json({ ok: true });
}

export async function googleHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.loginWithGoogle(req.body.credential);
  setAuthCookies(res, result); // same cookie session as password login / signup
  void captureUserCountry(result.user.id, readCountry(req));
  res.json(result);
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  // The refresh token comes from the httpOnly cookie (browser) or the JSON body (legacy /
  // automation clients). Either establishes a fresh, rotated pair.
  const presented = req.cookies?.[RT_COOKIE] ?? req.body?.refreshToken;
  if (!presented) throw Unauthorized('Missing refresh token');
  const result = await authService.refresh(presented);
  setAuthCookies(res, result);
  res.json(result);
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  const user = await authService.me(req.user!.id);
  // Report the EFFECTIVE role (the active tenant's membership role under enforcement), which
  // requireAuth already resolved — not the raw global User.role. `workspace` carries the active
  // tenant's plan + trial state + feature capabilities so the client can gate UI / show the wall.
  const workspace = await authService.activeWorkspace(req.user!.tid);
  res.json({ user: { ...user, role: req.user!.role }, workspace });
}

export async function myTenantsHandler(req: Request, res: Response): Promise<void> {
  const tenants = await authService.listMyTenants(req.user!.id);
  res.json({ tenants, active: req.user!.tid ?? null });
}

export async function switchTenantHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.switchTenant(req.user!.id, req.body.tenantId);
  setAuthCookies(res, result); // re-mint the session pinned to the chosen tenant
  res.json(result);
}

export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  // Returns a fresh token pair: changing the password revokes other sessions, so the
  // caller needs new tokens to keep this one alive. Refresh the cookies too.
  const result = await authService.changePassword(req.user!.id, req.body);
  setAuthCookies(res, result);
  res.json(result);
}

export async function updatePreferencesHandler(req: Request, res: Response): Promise<void> {
  const prefs = await authService.updatePreferences(req.user!.id, req.body);
  res.json(prefs);
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  await authService.logoutAll(req.user!.id);
  clearAuthCookies(res);
  res.json({ ok: true });
}
