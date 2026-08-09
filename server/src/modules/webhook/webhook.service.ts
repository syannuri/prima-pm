import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { generateWebhookSecret, signWebhook, SIGNATURE_HEADER, EVENT_HEADER, DELIVERY_HEADER } from '../../lib/webhook.js';

// The event names a subscription may listen for (plus '*' = all). Keep in sync with the emit points.
export const WEBHOOK_EVENTS = [
  'project.created',
  'project.status_changed',
  'baseline.locked',
  'risk.created',
  'change_request.approved',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_ATTEMPTS = 5;
// Minutes to wait before attempts 2..5 after a failure (attempt 1 is immediate on enqueue).
const BACKOFF_MINUTES = [1, 5, 30, 120];
const TIMEOUT_MS = 10_000;

// ---- Subscription management (tenant-scoped; ADMIN only via the routes) ---------------------------

// Never selects `secret` — it's returned only once, by createSubscription.
const subSelect = { id: true, url: true, events: true, active: true, createdAt: true } as const;

export async function listSubscriptions() {
  return prisma.webhookSubscription.findMany({ orderBy: { createdAt: 'desc' }, select: subSelect });
}

export async function createSubscription(input: { url: string; events: string[] }, actorId: string) {
  const secret = generateWebhookSecret();
  const row = await prisma.webhookSubscription.create({
    data: { url: input.url, events: input.events, secret, createdById: actorId },
    select: subSelect,
  });
  await writeAudit({ userId: actorId, entity: 'WebhookSubscription', entityId: row.id, action: 'CREATE', after: { url: row.url, events: row.events } });
  // The signing secret is shown to the caller this one time only (needed to verify deliveries).
  return { ...row, secret };
}

export async function deleteSubscription(id: string, actorId: string) {
  const existing = await prisma.webhookSubscription.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw NotFound('Webhook subscription not found');
  await prisma.webhookSubscription.delete({ where: { id } });
  await writeAudit({ userId: actorId, entity: 'WebhookSubscription', entityId: id, action: 'DELETE' });
}

export async function listDeliveries(limit = 50) {
  return prisma.webhookDelivery.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, subscriptionId: true, event: true, status: true, attempts: true, responseStatus: true, error: true, createdAt: true, deliveredAt: true },
  });
}

// ---- Event emission + delivery -------------------------------------------------------------------

// Fire a domain event to every active subscription in the CURRENT tenant that listens for it. Called
// from inside domain services (so it runs in tenant context). Best-effort: it must NEVER throw into
// the business transaction — a webhook problem can't fail the underlying operation.
// Immediate-delivery-on-enqueue can be turned off so tests drive delivery deterministically
// (otherwise the fire-and-forget sweep races an explicit call). Always on in production.
let autoDeliver = true;
export function __setAutoDeliver(on: boolean): void { autoDeliver = on; }

export async function enqueueWebhookEvent(event: WebhookEvent | string, payload: Prisma.InputJsonValue): Promise<void> {
  try {
    const subs = await prisma.webhookSubscription.findMany({ where: { active: true }, select: { id: true, events: true } });
    const matched = subs.filter((s) => s.events.includes('*') || s.events.includes(event));
    if (matched.length === 0) return;
    await prisma.webhookDelivery.createMany({
      data: matched.map((s) => ({ subscriptionId: s.id, event, payload })),
    });
    // Attempt delivery right away; the periodic sweep handles retries.
    if (autoDeliver) void deliverDueDeliveries().catch(() => {});
  } catch (err) {
    console.error('[webhook] enqueue failed', err);
  }
}

// De-dupe concurrent sends of the same delivery within this process (the immediate trigger and the
// periodic sweep can overlap). Single Node process, so an in-memory guard suffices.
const inFlight = new Set<string>();

// Drain due deliveries (PENDING with nextAttemptAt in the past). Runs as SYSTEM so it sweeps ACROSS
// tenants (called context-less from the scheduler, and via enqueue). Safe to call frequently.
export async function deliverDueDeliveries(limit = 20): Promise<number> {
  return runAsSystem(async () => {
    const due = await prisma.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      include: { subscription: { select: { url: true, secret: true, active: true } } },
    });
    let delivered = 0;
    for (const d of due) {
      if (inFlight.has(d.id)) continue;
      inFlight.add(d.id);
      try {
        if (!d.subscription.active) {
          await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', error: 'subscription inactive' } });
          continue;
        }
        if (await attemptDelivery(d)) delivered++;
      } finally {
        inFlight.delete(d.id);
      }
    }
    return delivered;
  });
}

type DueDelivery = Prisma.WebhookDeliveryGetPayload<{ include: { subscription: { select: { url: true; secret: true; active: true } } } }>;

// POST one delivery, HMAC-signed; record the outcome and schedule a retry (with backoff) or give up.
// Assumes it's already running inside runAsSystem (so the scoped updates aren't tenant-filtered).
async function attemptDelivery(d: DueDelivery): Promise<boolean> {
  const body = JSON.stringify({ id: d.id, event: d.event, createdAt: d.createdAt, data: d.payload });
  const ts = Math.floor(Date.now() / 1000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let responseStatus: number | null = null;
  let error: string | null = null;
  let ok = false;
  try {
    const res = await fetch(d.subscription.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        [EVENT_HEADER]: d.event,
        [DELIVERY_HEADER]: d.id,
        [SIGNATURE_HEADER]: `t=${ts},v1=${signWebhook(d.subscription.secret, ts, body)}`,
      },
      body,
    });
    responseStatus = res.status;
    ok = res.ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error)?.name === 'AbortError' ? 'timeout' : ((e as Error)?.message ?? 'network error');
  } finally {
    clearTimeout(timer);
  }

  const attempts = d.attempts + 1;
  if (ok) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'SUCCESS', attempts, responseStatus, error: null, deliveredAt: new Date() } });
  } else if (attempts >= MAX_ATTEMPTS) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', attempts, responseStatus, error } });
  } else {
    const mins = BACKOFF_MINUTES[attempts - 1] ?? 120;
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'PENDING', attempts, responseStatus, error, nextAttemptAt: new Date(Date.now() + mins * 60_000) } });
  }
  return ok;
}
