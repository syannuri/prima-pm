// Event-driven proactive Anett (Phase 2). The weekly sweep (proactive.service) is calendar-driven; a
// project can blow up mid-week and the PM only learns at the next window. This adds a real-time path:
//
//   1. A DOMAIN EVENT (new HIGH risk / raised change request) or a deterministic BREACH SCAN (cost
//      overrun / schedule slip crossing HIGH) inserts ONE lightweight AiProactiveTrigger row — cheap,
//      no LLM in the request path.
//   2. A frequent DRAIN tick coalesces the pending triggers per project into a SINGLE event-framed
//      AiBriefing (LLM, cheap model), notifies the PM, and stamps the triggers processed.
//
// At most one event briefing per project per day (period='event', periodKey=dayKey), so a burst of
// events or a persistent breach never spams the inbox. DORMANT unless the AI key is set AND the tenant
// opted into aiProactiveEnabled AND the stronger aiProactiveRealtime sub-opt-in. Nothing is published:
// the PM reviews each briefing and Applies or Dismisses it, exactly like the weekly sweep.
import { prisma } from '../../lib/prisma.js';
import { runAsSystem, runWithTenant, getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled, aiConfig, getAiPort } from '../../lib/ai.js';
import { logger } from '../../lib/observability.js';
import { getProjectReport } from './report.service.js';
import { buildNarrativePrompt, type NarrativeLang } from './narrative.service.js';
import { getProjectPredictive } from '../predictive/predictive.service.js';
import { createNotification } from '../notification/notification.service.js';

export type ProactiveTriggerKind = 'RISK_SPIKE' | 'CR_RAISED' | 'BASELINE_BREACH' | 'OVERDUE_CASCADE';

const EVENT_PERIOD = 'event' as const;
const dayKeyOf = (now: Date): string => now.toISOString().slice(0, 10); // YYYY-MM-DD
const MAX_PROJECTS_PER_TENANT = Number(process.env.PROACTIVE_MAX_PROJECTS ?? 25);
const draftLang = (): NarrativeLang => (process.env.PROACTIVE_LANG === 'id' ? 'id' : 'en');

// Whether the CALLER's active tenant has opted into event-driven proactive. Requires BOTH the base
// proactive opt-in and the realtime sub-opt-in. A single-tenant deploy (no tenant store) needs only the
// env gate. One cheap query — used to avoid writing trigger rows for tenants that will never drain them.
async function callerRealtimeEnabled(): Promise<boolean> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true; // single-tenant: env gate alone governs
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiProactiveEnabled: true, aiProactiveRealtime: true } });
  return t?.aiProactiveEnabled === true && t?.aiProactiveRealtime === true;
}

// Insert (or coalesce onto) a pending trigger. Idempotent per (project, kind, day): a burst of the same
// event kind on the same project collapses to one row via the unique key. Best-effort — a queue write
// must NEVER throw into the business operation that emitted the event. Runs in the caller's tenant
// context (the row is auto-stamped with tenantId by the tenant extension).
export async function enqueueProactiveTrigger(input: {
  projectId: string; kind: ProactiveTriggerKind; summary: string; now?: Date;
}): Promise<void> {
  if (!aiEnabled()) return;
  try {
    if (!(await callerRealtimeEnabled())) return;
    const dayKey = dayKeyOf(input.now ?? new Date());
    await prisma.aiProactiveTrigger.upsert({
      where: { projectId_kind_dayKey: { projectId: input.projectId, kind: input.kind, dayKey } },
      create: { projectId: input.projectId, kind: input.kind, summary: input.summary, dayKey },
      update: {}, // already queued today — keep the first row (idempotent), don't reset processedAt
    });
  } catch (err) {
    logger.warn({ err, projectId: input.projectId, kind: input.kind }, '[proactive-event] enqueue failed (ignored)');
  }
}

// Map a fanned-out domain event to a proactive trigger. Called from emitDomainEvent's fan-out (best-
// effort there too). Only the discrete, high-signal events enqueue — a healthy edit never does.
export async function enqueueFromDomainEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : undefined;
  if (!projectId) return;
  if (event === 'risk.created' && (payload.severity === 'HIGH' || payload.severity === 'CRITICAL')) {
    const code = typeof payload.code === 'string' ? payload.code : 'a risk';
    const title = typeof payload.title === 'string' ? payload.title : '';
    const sev = String(payload.severity).toLowerCase();
    await enqueueProactiveTrigger({ projectId, kind: 'RISK_SPIKE', summary: `New ${sev}-severity risk ${code}${title ? ` — ${title}` : ''}` });
  } else if (event === 'change_request.created') {
    const title = typeof payload.title === 'string' ? payload.title : 'a change request';
    await enqueueProactiveTrigger({ projectId, kind: 'CR_RAISED', summary: `Change request raised — ${title}` });
  }
}

// A short label for the notification, keyed on which kinds fired.
function triggerHeadline(kinds: Set<string>): string {
  if (kinds.has('BASELINE_BREACH') || kinds.has('OVERDUE_CASCADE')) return 'performance breach';
  if (kinds.has('RISK_SPIKE')) return 'new high risk';
  if (kinds.has('CR_RAISED')) return 'change request';
  return 'update';
}

// Draft ONE event-framed briefing for a project from its pending triggers (best-effort). Reuses the
// weekly narrative prompt but leads with the trigger reasons so the draft explains WHAT fired. Returns
// true if a new PENDING briefing was created. Skips (still marks triggers processed by the caller) when
// an event briefing already exists for today or the model declines.
async function draftEventBriefing(
  p: { id: string; code: string; name: string; pmUserId: string | null; tenantId: string | null },
  triggers: { kind: string; summary: string }[],
  now: Date,
): Promise<boolean> {
  const key = dayKeyOf(now);
  const existing = await prisma.aiBriefing.findUnique({
    where: { projectId_period_periodKey: { projectId: p.id, period: EVENT_PERIOD, periodKey: key } },
    select: { id: true },
  });
  if (existing) return false; // already have an event briefing for this project today

  const report = await getProjectReport(p.id, 'weekly', now);
  const { system, user } = buildNarrativePrompt(report, draftLang());
  const reasons = triggers.map((t) => `- ${t.summary}`).join('\n');
  const framed = `${user}\n\nThis status update was TRIGGERED IN REAL TIME by these events — open with what they mean and the recommended next action:\n${reasons}`;
  const model = aiConfig().proactiveModel;
  const draft = await getAiPort().draftNarrative({ system, user: framed, model, feature: 'proactive' });
  if (!draft) return false;

  const pred = await getProjectPredictive(p.id, now);
  await prisma.aiBriefing.create({
    data: {
      projectId: p.id, tenantId: p.tenantId, period: EVENT_PERIOD, periodKey: key, status: 'PENDING',
      execSummary: draft.executiveSummary, highlights: draft.highlights, lowlights: draft.lowlights, nextFocus: draft.nextFocus,
      slipLevel: pred.slip?.level ?? null, slipScore: pred.slip?.score ?? null,
      overrunLevel: pred.overrun?.level ?? null, overrunScore: pred.overrun?.score ?? null,
      model, generatedAt: now,
    },
  });

  if (p.pmUserId) {
    const kinds = new Set(triggers.map((t) => t.kind));
    await createNotification({
      userId: p.pmUserId,
      type: 'AI_BRIEFING_READY',
      title: `⚡ AI flagged ${p.code} — ${triggerHeadline(kinds)}`,
      body: `A real-time event on “${p.name}” triggered an instant status draft. Review it in Reports.`,
      projectId: p.id,
      link: '/reports',
    });
  }
  return true;
}

// Deterministic breach scan (no LLM): enqueue BASELINE_BREACH / OVERDUE_CASCADE triggers for any active
// project whose predictive signal is HIGH. Runs inside a tenant context. Idempotent per day via the
// trigger unique key, so a persistent breach enqueues once per day, not every tick.
async function scanBreaches(now: Date): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, status: 'IN_PROGRESS' },
    select: { id: true, code: true },
    take: MAX_PROJECTS_PER_TENANT,
  });
  for (const p of projects) {
    try {
      const pred = await getProjectPredictive(p.id, now);
      if (pred.overrun?.level === 'HIGH') {
        await enqueueProactiveTrigger({ projectId: p.id, kind: 'BASELINE_BREACH', summary: `Cost overrun crossed HIGH (score ${pred.overrun.score})`, now });
      }
      if (pred.slip?.level === 'HIGH') {
        await enqueueProactiveTrigger({ projectId: p.id, kind: 'OVERDUE_CASCADE', summary: `Schedule slip crossed HIGH (score ${pred.slip.score})`, now });
      }
    } catch (err) {
      logger.warn({ err, projectId: p.id }, '[proactive-event] breach scan failed (ignored)');
    }
  }
}

// The drain tick (registered in server.ts alongside the other sweeps). For every opted-in + realtime
// tenant: run the breach scan (enqueues computed triggers), then coalesce all pending triggers per
// project into a single event briefing. A cheap no-op when the key is unset or nothing is pending.
export async function runProactiveEventDrainIfDue(now: Date = new Date()): Promise<{ drafted: number }> {
  if (!aiEnabled()) return { drafted: 0 };
  const tenants = await runAsSystem(() =>
    prisma.tenant.findMany({ where: { aiProactiveEnabled: true, aiProactiveRealtime: true, status: 'ACTIVE' }, select: { id: true } }),
  );
  let drafted = 0;
  for (const t of tenants) {
    await runWithTenant(t.id, async () => {
      await scanBreaches(now);

      const pending = await prisma.aiProactiveTrigger.findMany({
        where: { processedAt: null },
        select: { id: true, projectId: true, kind: true, summary: true },
      });
      if (pending.length === 0) return;

      // Group pending triggers by project so each project drafts at most one coalesced briefing.
      const byProject = new Map<string, { id: string; kind: string; summary: string }[]>();
      for (const tr of pending) {
        const arr = byProject.get(tr.projectId) ?? [];
        arr.push(tr);
        byProject.set(tr.projectId, arr);
      }
      const projects = await prisma.project.findMany({
        where: { id: { in: [...byProject.keys()] }, deletedAt: null },
        select: { id: true, code: true, name: true, pmUserId: true, tenantId: true },
      });
      const projById = new Map(projects.map((p) => [p.id, p]));

      for (const [projectId, triggers] of byProject) {
        const p = projById.get(projectId);
        const ids = triggers.map((tr) => tr.id);
        try {
          // Draft only for a live project; a deleted/archived one just has its triggers cleared.
          if (p) { if (await draftEventBriefing(p, triggers, now)) drafted++; }
        } catch (err) {
          logger.error({ err, projectId }, '[proactive-event] drain draft failed');
        }
        // Mark processed regardless (drafted, deduped, or project gone) so the queue makes progress and
        // the same triggers can't redraft next tick.
        await prisma.aiProactiveTrigger.updateMany({ where: { id: { in: ids } }, data: { processedAt: now } });
      }
    });
  }
  return { drafted };
}
