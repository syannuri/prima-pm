import type { TenantPlan } from '@prisma/client';
import { prisma } from './prisma.js';
import { AppError } from './errors.js';
import { getTenantStore } from './tenant/context.js';
import { summarizeTenantUsage } from './aiUsage.js';

// Per-tenant monthly AI budget cap (improvement #4). DORMANT BY DEFAULT: with no env config there is
// no cap and the enforcement path does ZERO database work, so nothing changes until an operator opts
// in. Configure caps (USD/month) either per-plan via AI_BUDGET_JSON, e.g.
//   AI_BUDGET_JSON={"TRIAL":5,"PRO":50,"ENTERPRISE":500,"PERSONAL":1}
// or a single flat cap for every workspace via AI_BUDGET_USD. A cap of 0/negative/absent = unlimited.
// Cost is the same read-time estimate as the dashboard (lib/aiPricing), so a price change moves the
// budget line too, no migration.

export function budgetsConfigured(): boolean {
  return Boolean(process.env.AI_BUDGET_JSON || process.env.AI_BUDGET_USD);
}

// The month-to-date cap for this plan, or null when uncapped. `isPersonal` guests use the optional
// PERSONAL key (falls back to TRIAL, then flat).
export function monthlyCapUsd(plan: TenantPlan, isPersonal: boolean): number | null {
  const flat = Number(process.env.AI_BUDGET_USD);
  const raw = process.env.AI_BUDGET_JSON;
  let cap: number | undefined;
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, number | null>;
      const key = isPersonal && map.PERSONAL != null ? 'PERSONAL' : plan;
      const v = map[key];
      if (typeof v === 'number') cap = v;
    } catch {
      // Malformed → ignore (fall through to flat / unlimited).
    }
  }
  if (cap === undefined && Number.isFinite(flat)) cap = flat;
  if (cap === undefined || cap <= 0) return null; // absent / 0 / negative = unlimited
  return cap;
}

// Throw before a Claude call when the active tenant is over its month-to-date budget. No-op (and no DB
// query) unless caps are configured. Called from the live AI port; the fake ports used in tests skip it.
export async function assertAiBudget(): Promise<void> {
  if (!budgetsConfigured()) return;
  const tenantId = getTenantStore()?.tenantId;
  if (!tenantId) return; // no tenant context (cron/system) → not budgeted here
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, isPersonal: true } });
  if (!tenant) return;
  const cap = monthlyCapUsd(tenant.plan, tenant.isPersonal);
  if (cap == null) return;
  const used = (await summarizeTenantUsage(monthStart())).totals.estimatedCostUsd;
  if (used >= cap) {
    throw new AppError(429, `Batas biaya AI bulan ini tercapai ($${used.toFixed(2)} dari $${cap.toFixed(2)}). Naikkan paket atau tunggu bulan berikutnya.`, 'AI_BUDGET_EXCEEDED');
  }
}

// Budget line for the dashboard: cap + used + remaining, or null when uncapped. Reuses the same
// month-to-date total the summary already computes so the caller can pass it in to avoid a second read.
export async function budgetStatus(usedUsd?: number): Promise<{ capUsd: number; usedUsd: number; remainingUsd: number } | null> {
  const tenantId = getTenantStore()?.tenantId;
  if (!budgetsConfigured() || !tenantId) return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, isPersonal: true } });
  if (!tenant) return null;
  const cap = monthlyCapUsd(tenant.plan, tenant.isPersonal);
  if (cap == null) return null;
  const used = usedUsd ?? (await summarizeTenantUsage(monthStart())).totals.estimatedCostUsd;
  return { capUsd: cap, usedUsd: used, remainingUsd: Math.max(0, cap - used) };
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
