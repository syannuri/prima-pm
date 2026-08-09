import type { Prisma } from '@prisma/client';
import { enqueueWebhookEvent } from '../webhook/webhook.service.js';
import { runAutomations } from '../automation/automation.service.js';

// Single fan-out for domain events: deliver to outbound webhooks AND run no-code automations. Both
// sides are best-effort (they never throw into the caller), so business operations are never affected
// by a webhook or automation problem. Emit points call this instead of the webhook fn directly.
export async function emitDomainEvent(event: string, payload: Prisma.InputJsonValue): Promise<void> {
  await enqueueWebhookEvent(event, payload);
  await runAutomations(event, payload as Prisma.JsonValue);
}
