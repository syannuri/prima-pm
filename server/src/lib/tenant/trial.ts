import type { TenantPlan } from '@prisma/client';

// 60-day trial lifecycle helpers (Phase 6 subscription plans; see docs/SUBSCRIPTION-PLANS-PLAN.md).
const DAY_MS = 24 * 60 * 60 * 1000;

// Trial length in days — a live env read so it's tunable per deployment. Invalid/<=0 ⇒ 60.
export function trialDays(): number {
  const n = Number(process.env.TRIAL_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

// A fresh trial deadline `trialDays()` from `from` — stamped when a corporate workspace starts its trial.
export function newTrialExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + trialDays() * DAY_MS);
}

// Is a TRIAL plan past its deadline (→ the upgrade wall)? A NULL deadline is deliberately NOT expired
// (a bare/admin-provisioned tenant or grace period); the lapsed-subscription case stamps an explicit
// PAST deadline (Phase 4) rather than relying on null. Non-TRIAL plans (PRO/ENTERPRISE) never expire.
export function isTrialExpired(plan: TenantPlan, trialEndsAt: Date | null): boolean {
  return plan === 'TRIAL' && trialEndsAt != null && trialEndsAt.getTime() <= Date.now();
}

// Whole days left on a trial (0 once past); null when there's no trial deadline. Drives the client
// countdown banner.
export function trialDaysLeft(trialEndsAt: Date | null): number | null {
  if (trialEndsAt == null) return null;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY_MS));
}
