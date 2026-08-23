import { z } from 'zod';

// Small denylist of obviously-weak / known-breached passwords (incl. the seed demo
// password). Compared case-insensitively. Not a substitute for HIBP, just a guardrail.
const WEAK_PASSWORDS = new Set([
  'password123!',
  'password123',
  'password1',
  'password',
  'passw0rd',
  'qwerty123',
  '12345678',
  '123456789',
  'admin123',
  'changeme',
  'letmein',
  'prima123',
]);

// Reusable strong-password rule (shared by self-change and admin set/reset).
export const strongPassword = z
  .string()
  .min(10)
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Use at least one letter and one number')
  .refine((v) => !WEAK_PASSWORDS.has(v.toLowerCase()), 'That password is too common / known from breaches — pick a stronger one');

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

// Self-service guest signup — same strong-password rule as the rest of the app. Always
// creates a GUEST (the service hard-codes the role; the client can't pick it).
export const guestRegisterSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: strongPassword,
});

// Self-serve organization signup (Phase 6) — creates a corporate tenant + its owner admin.
export const orgSignupSchema = z.object({
  orgName: z.string().min(2).max(120),
  ownerName: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: strongPassword,
});

// refreshToken is optional in the body: the browser sends it as an httpOnly cookie instead
// (the controller reads cookie-or-body). Legacy/automation clients may still post it here.
// Google sign-in: the client posts the ID token (JWT credential) returned by Google Identity
// Services. The server verifies it against Google and derives the account from its claims.
export const googleLoginSchema = z.object({
  credential: z.string().min(20),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

// Switch the active tenant (pooled multitenancy). The service rejects a tenant the caller has no
// membership in, so this only needs the id.
export const switchTenantSchema = z.object({
  tenantId: z.string().min(1),
});

// The customizable desktop dashboard widgets (keys the client renders + the layout stores).
export const DASHBOARD_WIDGET_KEYS = [
  'actionCenter', 'planningReminders', 'awaitingActivation', 'awaitingClosure',
  'pendingApprovals', 'portfolioSummary', 'portfolioEvmTrend',
] as const;

// Self-service account preferences — all fields optional (a partial update). digestFrequency = emailed
// alert-digest cadence; dashboardLayout = ordered enabled-widget keys; dashboardDefaultView = landing tab.
export const updatePreferencesSchema = z
  .object({
    digestFrequency: z.enum(['OFF', 'DAILY', 'WEEKLY']).optional(),
    dashboardLayout: z.array(z.enum(DASHBOARD_WIDGET_KEYS)).max(20).optional(),
    dashboardDefaultView: z.enum(['portfolio', 'forecast', 'resources', 'cards']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No preferences provided' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: strongPassword,
  })
  .superRefine((d, ctx) => {
    if (d.newPassword === d.currentPassword)
      ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'New password must differ from the current one' });
  });

// Email activation: redeem a token, and resend an activation link to an unverified account.
export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export const resendActivationSchema = z.object({
  email: z.string().email().toLowerCase(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type GuestRegisterInput = z.infer<typeof guestRegisterSchema>;
export type OrgSignupInput = z.infer<typeof orgSignupSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
