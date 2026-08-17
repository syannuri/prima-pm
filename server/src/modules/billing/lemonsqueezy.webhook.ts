import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TenantPlan } from '@prisma/client';
import { lsConfig, billingEnabled } from '../../config/env.js';
import { applySubscriptionChange, variantToPlan } from './billing.service.js';

// Lemon Squeezy webhook receiver. Mounted OUTSIDE the /api/v1 router and BEFORE express.json()
// so it sees the raw body (required to verify the HMAC signature) and skips CSRF/cookie checks
// (this is a server-to-server call). See docs / app.ts wiring.
//
// Security: every request must carry a valid `X-Signature` (hex HMAC-SHA256 of the raw body,
// keyed by LEMONSQUEEZY_WEBHOOK_SECRET). We compare in constant time and reject otherwise.

// The subscription lifecycle events we act on. Everything else (orders, license keys, …) is
// acknowledged with 200 but ignored — LS treats a non-2xx as a failure and retries.
const SUB_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_resumed',
  'subscription_unpaused',
  'subscription_paused',
  'subscription_cancelled',
  'subscription_expired',
]);

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', lsConfig().webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
}

export async function lemonsqueezyWebhook(req: Request, res: Response): Promise<void> {
  if (!billingEnabled()) {
    res.status(503).json({ error: 'Billing is not configured.' });
    return;
  }
  // express.raw() leaves req.body as a Buffer; fall back defensively.
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? ''));
  const signature = (req.header('X-Signature') ?? req.header('x-signature')) || undefined;
  if (!verifySignature(rawBody, signature)) {
    res.status(401).json({ error: 'Invalid signature.' });
    return;
  }

  let payload: {
    meta?: { event_name?: string; custom_data?: { tenant_id?: string } };
    data?: { id?: string; attributes?: Record<string, unknown> };
  };
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Malformed JSON.' });
    return;
  }

  const eventName = payload.meta?.event_name ?? '';
  const tenantId = payload.meta?.custom_data?.tenant_id;

  // Ignore events we don't handle (still 200 so LS stops retrying).
  if (!SUB_EVENTS.has(eventName)) {
    res.status(200).json({ ignored: eventName });
    return;
  }
  // A subscription event with no tenant tag can't be mapped — acknowledge but do nothing.
  if (!tenantId) {
    res.status(200).json({ ignored: 'no tenant_id in custom_data' });
    return;
  }

  const attrs = payload.data?.attributes ?? {};
  const lsSubscriptionId = String(payload.data?.id ?? attrs['subscription_id'] ?? '');
  const status = String(attrs['status'] ?? '');
  const paidPlan = variantToPlan(attrs['variant_id'] as string | number | undefined);

  // Decide the resulting plan:
  //  - expired  ⇒ downgrade to TRIAL (paid period is over → the upgrade wall; Phase 4 also stamps
  //    trialEndsAt=now so it reads as an EXPIRED trial, not a fresh one)
  //  - otherwise ⇒ the paid plan for the purchased variant (cancelled keeps access until ends_at,
  //    at which point an `expired` event flips it to TRIAL)
  const expired = eventName === 'subscription_expired' || status === 'expired';
  let plan: TenantPlan;
  if (expired) {
    plan = 'TRIAL';
  } else if (paidPlan) {
    plan = paidPlan;
  } else {
    // Unknown variant — don't guess a plan; acknowledge and skip.
    res.status(200).json({ ignored: `unmapped variant ${String(attrs['variant_id'])}` });
    return;
  }

  try {
    await applySubscriptionChange(
      tenantId,
      {
        plan,
        status: status || eventName,
        lsSubscriptionId,
        lsCustomerId: attrs['customer_id'] != null ? String(attrs['customer_id']) : null,
        lsVariantId: attrs['variant_id'] != null ? String(attrs['variant_id']) : null,
        renewsAt: toDate(attrs['renews_at']),
        endsAt: toDate(attrs['ends_at']),
      },
      eventName,
      payload,
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[billing] failed to apply webhook', eventName, err);
    // 500 → LS will retry the delivery, which is safe (applySubscriptionChange is idempotent).
    res.status(500).json({ error: 'Failed to process event.' });
  }
}
