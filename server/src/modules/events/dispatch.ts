import type { Prisma } from '@prisma/client';
import { enqueueWebhookEvent } from '../webhook/webhook.service.js';
import { runAutomations } from '../automation/automation.service.js';
import { enqueueFromDomainEvent } from '../report/proactiveEvents.service.js';

// Single fan-out for domain events: deliver to outbound webhooks, run no-code automations, AND enqueue
// event-driven proactive triggers (Phase 2). All three sides are best-effort (they never throw into the
// caller), so business operations are never affected by a webhook/automation/proactive problem. Emit
// points call this instead of the webhook fn directly.
export async function emitDomainEvent(event: string, payload: Prisma.InputJsonValue): Promise<void> {
  await enqueueWebhookEvent(event, payload);
  await runAutomations(event, payload as Prisma.JsonValue);
  // Proactive is self-guarded (dormant unless the tenant opted into realtime); the extra try/catch here
  // keeps a proactive failure from ever affecting the webhook/automation side above.
  try { await enqueueFromDomainEvent(event, (payload ?? {}) as Record<string, unknown>); } catch { /* ignore */ }
}
