import type { Prisma, Role, AutomationRule } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import { createNotification } from '../notification/notification.service.js';
import { tenantMemberUserIds } from '../../lib/tenant/members.js';

// No-code automation rules (event → notify). CRUD is ADMIN-only via the routes; runAutomations is
// invoked by the domain-event dispatcher on every emitted event (best-effort — never throws into the
// business op).

export async function listRules() {
  return prisma.automationRule.findMany({ orderBy: { createdAt: 'desc' } });
}

export interface RuleInput {
  name: string;
  event: string;
  conditionField?: string | null;
  conditionEquals?: string | null;
  notifyPm?: boolean;
  notifyRole?: Role | null;
  messageTemplate?: string | null;
}

export async function createRule(input: RuleInput, actorId: string) {
  const row = await prisma.automationRule.create({
    data: {
      name: input.name,
      event: input.event,
      conditionField: input.conditionField ?? null,
      conditionEquals: input.conditionEquals ?? null,
      notifyPm: input.notifyPm ?? false,
      notifyRole: input.notifyRole ?? null,
      messageTemplate: input.messageTemplate ?? null,
      createdById: actorId,
    },
  });
  await writeAudit({ userId: actorId, entity: 'AutomationRule', entityId: row.id, action: 'CREATE', after: { name: row.name, event: row.event } });
  return row;
}

export async function deleteRule(id: string, actorId: string) {
  const existing = await prisma.automationRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw NotFound('Automation rule not found');
  await prisma.automationRule.delete({ where: { id } });
  await writeAudit({ userId: actorId, entity: 'AutomationRule', entityId: id, action: 'DELETE' });
}

// ---- Execution -----------------------------------------------------------------------------------

const payloadStr = (payload: Prisma.JsonValue, field: string): string => {
  const o = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
  return o[field] == null ? '' : String(o[field]);
};

function defaultTitle(event: string): string {
  switch (event) {
    case 'project.created': return 'A project was created';
    case 'project.status_changed': return 'A project changed status';
    case 'baseline.locked': return 'A baseline was locked';
    case 'risk.created': return 'A new risk was raised';
    case 'change_request.approved': return 'A change request was approved';
    default: return `Event: ${event}`;
  }
}

// Fire all active rules for this event in the CURRENT tenant. Best-effort; called from the dispatcher.
export async function runAutomations(event: string, payload: Prisma.JsonValue): Promise<void> {
  try {
    const rules = await prisma.automationRule.findMany({ where: { active: true, event } });
    for (const rule of rules) {
      if (rule.conditionField && payloadStr(payload, rule.conditionField) !== (rule.conditionEquals ?? '')) continue;
      await executeRule(rule, event, payload).catch((err) => console.error('[automation] rule failed', rule.id, err));
    }
  } catch (err) {
    console.error('[automation] run failed', err);
  }
}

async function executeRule(rule: AutomationRule, event: string, payload: Prisma.JsonValue): Promise<void> {
  if (rule.actionType !== 'NOTIFY') return;
  const projectId = payloadStr(payload, 'projectId') || payloadStr(payload, 'id') || null;

  const recipients = new Set<string>();
  if (rule.notifyPm && projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { pmUserId: true } });
    if (project?.pmUserId) recipients.add(project.pmUserId);
  }
  if (rule.notifyRole) {
    for (const uid of await tenantMemberUserIds([rule.notifyRole])) recipients.add(uid);
  }
  if (recipients.size === 0) return;

  const title = rule.messageTemplate?.trim() || defaultTitle(event);
  const name = payloadStr(payload, 'name') || payloadStr(payload, 'code') || payloadStr(payload, 'title');
  const body = `Automation "${rule.name}"${name ? ` · ${name}` : ''}`;
  for (const userId of recipients) {
    await createNotification({ userId, type: 'AUTOMATION', title, body, projectId });
  }
}
