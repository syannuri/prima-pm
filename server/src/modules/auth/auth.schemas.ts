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

// refreshToken is optional in the body: the browser sends it as an httpOnly cookie instead
// (the controller reads cookie-or-body). Legacy/automation clients may still post it here.
export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: strongPassword,
  })
  .superRefine((d, ctx) => {
    if (d.newPassword === d.currentPassword)
      ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'New password must differ from the current one' });
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
