import type { TenantPlan } from '@prisma/client';
import { lsConfig } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { AppError } from '../../lib/errors.js';

// The Lemon Squeezy REST API base. All calls are JSON:API and Bearer-authenticated with the
// (store-scoped) API key. We use native fetch (Node 18+) — no HTTP client dependency.
const LS_API = 'https://api.lemonsqueezy.com/v1';

// The two paid plans we sell self-serve. FREE is the default (no purchase); ENTERPRISE can also
// be granted manually by a platform admin via PATCH /admin/tenants/:id (sales path).
export type PaidPlan = 'PRO' | 'ENTERPRISE';

// Map an internal plan to its configured LS variant id, and back. Unknown/blank ⇒ null so a
// stray variant never silently flips a tenant.
export function planToVariant(plan: PaidPlan): string {
  const v = lsConfig().variantIds;
  return plan === 'PRO' ? v.pro : v.enterprise;
}
export function variantToPlan(variantId: string | number | null | undefined): PaidPlan | null {
  if (variantId == null) return null;
  const v = String(variantId);
  const ids = lsConfig().variantIds;
  if (v && v === ids.pro) return 'PRO';
  if (v && v === ids.enterprise) return 'ENTERPRISE';
  return null;
}

async function lsFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${LS_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${lsConfig().apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(502, `Lemon Squeezy API ${res.status}: ${body.slice(0, 300)}`, 'BILLING_UPSTREAM');
  }
  return res.json();
}

// Mint a hosted checkout URL for `plan`, tagged with `tenant_id` in custom data so the webhook
// can map the resulting subscription back to this tenant. Email is prefilled for convenience.
export async function createCheckoutUrl(plan: PaidPlan, tenantId: string, email: string): Promise<string> {
  const variantId = planToVariant(plan);
  if (!variantId) throw new AppError(503, `No Lemon Squeezy variant configured for the ${plan} plan.`, 'BILLING_UNCONFIGURED');
  const payload = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email,
          // LS echoes this back verbatim under meta.custom_data on every webhook for the sub.
          custom: { tenant_id: tenantId },
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: String(lsConfig().storeId) } },
        variant: { data: { type: 'variants', id: String(variantId) } },
      },
    },
  };
  const json = (await lsFetch('/checkouts', { method: 'POST', body: JSON.stringify(payload) })) as {
    data?: { attributes?: { url?: string } };
  };
  const url = json.data?.attributes?.url;
  if (!url) throw new AppError(502, 'Lemon Squeezy did not return a checkout URL.', 'BILLING_UPSTREAM');
  return url;
}

// The tenant's self-service portal (update card, cancel). Returned by LS on the subscription
// resource; we fetch it live so it is always a fresh signed URL.
export async function getPortalUrl(lsSubscriptionId: string): Promise<string> {
  const json = (await lsFetch(`/subscriptions/${lsSubscriptionId}`, { method: 'GET' })) as {
    data?: { attributes?: { urls?: { customer_portal?: string } } };
  };
  const url = json.data?.attributes?.urls?.customer_portal;
  if (!url) throw new AppError(502, 'Lemon Squeezy did not return a portal URL.', 'BILLING_UPSTREAM');
  return url;
}

export interface SubscriptionChange {
  plan: TenantPlan; // the plan the tenant should be on after this event
  status: string; // LS subscription status (active, cancelled, expired, past_due, ...)
  lsSubscriptionId: string;
  lsCustomerId?: string | null;
  lsVariantId?: string | null;
  renewsAt?: Date | null;
  endsAt?: Date | null;
}

// Apply a webhook-derived subscription change to a tenant: flip the plan + LS fields and record a
// BillingEvent + audit entry. Runs inside the tenant's context so the (tenant-scoped) AuditLog and
// BillingEvent writes are stamped correctly. Idempotent — safe to re-run for duplicate deliveries.
export async function applySubscriptionChange(
  tenantId: string,
  change: SubscriptionChange,
  eventName: string,
  rawPayload: unknown,
): Promise<void> {
  await runWithTenant(tenantId, async () => {
    const before = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
    if (!before) throw new AppError(404, `Unknown tenant ${tenantId} in billing webhook.`, 'BILLING_UNKNOWN_TENANT');
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        plan: change.plan,
        subscriptionStatus: change.status,
        lsSubscriptionId: change.lsSubscriptionId,
        lsCustomerId: change.lsCustomerId ?? undefined,
        lsVariantId: change.lsVariantId ?? undefined,
        renewsAt: change.renewsAt ?? null,
        endsAt: change.endsAt ?? null,
      },
    });
    await prisma.billingEvent.create({
      data: {
        tenantId,
        eventName,
        planBefore: before.plan,
        planAfter: change.plan,
        rawPayload: rawPayload as object,
      },
    });
    await writeAudit({
      entity: 'Tenant',
      entityId: tenantId,
      action: 'UPDATE',
      before: { plan: before.plan },
      after: { plan: change.plan, subscriptionStatus: change.status, via: `lemonsqueezy:${eventName}` },
    });
  });
}
