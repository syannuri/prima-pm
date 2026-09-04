// Proactive AI — the weekly portfolio sweep. For every ACTIVE project in an opted-in tenant it
// AUTO-DRAFTS a status narrative (LLM, cheap model) + captures the deterministic predictive
// slip/overrun signal, then stores a PENDING AiBriefing and notifies the project's PM. NOTHING is
// published: the PM reviews each briefing and Applies (→ writes a ProjectCommentary) or Dismisses.
//
// Mirrors the existing best-effort sweeps in server.ts (digest / trial-reminder): an hourly tick
// that only does work inside the configured send window, dormant unless the AI key is set AND the
// tenant opted in (Tenant.aiProactiveEnabled — a stronger opt-in than narrative AI, because this
// spends on the provider with no human click).
import { prisma } from '../../lib/prisma.js';
import { runAsSystem, runWithTenant } from '../../lib/tenant/context.js';
import { aiEnabled, aiConfig, getAiPort, NarrativeSchema, NARRATIVE_JSON_SCHEMA } from '../../lib/ai.js';
import { recordAiUsage } from '../../lib/aiUsage.js';
import { logger } from '../../lib/observability.js';
import { getProjectReport, periodKey } from './report.service.js';
import { buildNarrativePrompt, type NarrativeLang } from './narrative.service.js';
import { getProjectPredictive } from '../predictive/predictive.service.js';
import { createNotification } from '../notification/notification.service.js';
import { listProjects } from '../projects/projects.service.js';
import { NotFound } from '../../lib/errors.js';
import type { Role } from '@prisma/client';

const PERIOD = 'weekly' as const;

// Bound the per-tenant spend: cap how many projects one sweep drafts. A big portfolio still gets
// covered over subsequent windows (already-drafted periods are skipped, so it makes progress).
const MAX_PROJECTS_PER_TENANT = Number(process.env.PROACTIVE_MAX_PROJECTS ?? 25);

// Auto-drafts have no requesting user, so the language can't come from a UI toggle. Default English
// (the PM reviews/edits anyway); override with PROACTIVE_LANG=id.
const draftLang = (): NarrativeLang => (process.env.PROACTIVE_LANG === 'id' ? 'id' : 'en');

// Send window — reuse the digest env as a fallback so ops configure one schedule. Hour 0..23
// (server-local), weekday 0=Sun..6=Sat.
function proactiveSchedule(): { hour: number; weekday: number } {
  const hour = Number(process.env.PROACTIVE_HOUR ?? process.env.DIGEST_HOUR ?? 6);
  const weekday = Number(process.env.PROACTIVE_WEEKDAY ?? process.env.DIGEST_WEEKDAY ?? 1); // Monday
  return { hour: Number.isFinite(hour) ? hour : 6, weekday: Number.isFinite(weekday) ? weekday : 1 };
}

// Due only at the configured hour on the configured weekday. The per-project "already drafted this
// periodKey" guard makes a same-window re-tick idempotent, so no global last-run stamp is needed.
export function isProactiveDue(now: Date, sched = proactiveSchedule()): boolean {
  return now.getHours() === sched.hour && now.getDay() === sched.weekday;
}

// Draft one project's briefing (best-effort). Returns true if a new PENDING briefing was created.
// Must run inside the tenant context. Skips silently when a briefing for this period already exists
// (no repeat LLM spend) or when the model declines.
async function draftForProject(
  p: { id: string; code: string; name: string; pmUserId: string | null; tenantId: string | null },
  key: string,
  now: Date,
): Promise<boolean> {
  const existing = await prisma.aiBriefing.findUnique({
    where: { projectId_period_periodKey: { projectId: p.id, period: PERIOD, periodKey: key } },
    select: { id: true },
  });
  if (existing) return false; // already drafted this period — don't re-spend

  const report = await getProjectReport(p.id, PERIOD, now);
  const { system, user } = buildNarrativePrompt(report, draftLang());
  const model = aiConfig().proactiveModel;
  const draft = await getAiPort().draftNarrative({ system, user, model, feature: 'proactive' });
  if (!draft) return false; // refusal / empty — try again next window

  const pred = await getProjectPredictive(p.id, now);

  await prisma.aiBriefing.create({
    data: {
      projectId: p.id,
      tenantId: p.tenantId,
      period: PERIOD,
      periodKey: key,
      status: 'PENDING',
      execSummary: draft.executiveSummary,
      highlights: draft.highlights,
      lowlights: draft.lowlights,
      nextFocus: draft.nextFocus,
      slipLevel: pred.slip?.level ?? null,
      slipScore: pred.slip?.score ?? null,
      overrunLevel: pred.overrun?.level ?? null,
      overrunScore: pred.overrun?.score ?? null,
      model,
      generatedAt: now,
    },
  });

  if (p.pmUserId) {
    await createNotification({
      userId: p.pmUserId,
      type: 'AI_BRIEFING_READY',
      title: `AI drafted a status update for ${p.code}`,
      body: `Review the draft narrative for “${p.name}” and apply or dismiss it.`,
      projectId: p.id,
      link: '/reports',
    });
  }
  return true;
}

// Batch mode (#Batch): submit ALL project narrative drafts as ONE org-wide Message Batch (50% cheaper,
// async) instead of N synchronous calls. Dormant by default — set PROACTIVE_BATCH=1 to enable. The
// batch is finalised later by finalizeDueBatches() once Anthropic finishes processing.
function batchEnabled(): boolean {
  return process.env.PROACTIVE_BATCH === '1' || process.env.PROACTIVE_BATCH === 'true';
}

interface BatchMapEntry {
  tenantId: string | null; code: string; name: string; pmUserId: string | null;
  period: string; periodKey: string; model: string;
  slipLevel: string | null; slipScore: number | null; overrunLevel: string | null; overrunScore: number | null;
  generatedAt: string;
}

// Build the batch requests (one per not-yet-drafted active project across opted-in tenants), submit
// them, and record an AiBatch to finalise later. Returns how many were submitted.
async function submitProactiveBatch(now: Date): Promise<{ submitted: number }> {
  const tenants = await runAsSystem(() =>
    prisma.tenant.findMany({ where: { aiProactiveEnabled: true, status: 'ACTIVE' }, select: { id: true } }),
  );
  const key = periodKey(now, PERIOD);
  const model = aiConfig().proactiveModel;
  const requests: { customId: string; system: string; user: string; jsonSchema: Record<string, unknown>; model: string }[] = [];
  const mapping: Record<string, BatchMapEntry> = {};

  for (const t of tenants) {
    await runWithTenant(t.id, async () => {
      const projects = await prisma.project.findMany({
        where: { deletedAt: null, status: 'IN_PROGRESS' },
        select: { id: true, code: true, name: true, pmUserId: true, tenantId: true },
        take: MAX_PROJECTS_PER_TENANT,
      });
      for (const p of projects) {
        try {
          const existing = await prisma.aiBriefing.findUnique({
            where: { projectId_period_periodKey: { projectId: p.id, period: PERIOD, periodKey: key } },
            select: { id: true },
          });
          if (existing) continue;
          const report = await getProjectReport(p.id, PERIOD, now);
          const { system, user } = buildNarrativePrompt(report, draftLang());
          const pred = await getProjectPredictive(p.id, now);
          requests.push({ customId: p.id, system, user, jsonSchema: NARRATIVE_JSON_SCHEMA, model });
          mapping[p.id] = {
            tenantId: p.tenantId, code: p.code, name: p.name, pmUserId: p.pmUserId,
            period: PERIOD, periodKey: key, model,
            slipLevel: pred.slip?.level ?? null, slipScore: pred.slip?.score ?? null,
            overrunLevel: pred.overrun?.level ?? null, overrunScore: pred.overrun?.score ?? null,
            generatedAt: now.toISOString(),
          };
        } catch (err) {
          logger.error({ err, projectId: p.id }, '[proactive] batch build failed');
        }
      }
    });
  }
  if (requests.length === 0) return { submitted: 0 };

  const port = getAiPort();
  if (!port.submitBatch) return { submitted: 0 };
  const batchId = await port.submitBatch({ requests });
  if (!batchId) return { submitted: 0 };
  await runAsSystem(() => prisma.aiBatch.create({ data: { batchId, feature: 'proactive', status: 'PENDING', mapping: mapping as object } }));
  return { submitted: requests.length };
}

// Poll every in-flight proactive batch; when one has finished processing, create the AiBriefings from
// its results (mapped back per project) and mark it DONE. Runs on its own timer (see server.ts).
export async function finalizeDueBatches(now: Date = new Date()): Promise<{ drafted: number }> {
  if (!aiEnabled()) return { drafted: 0 };
  const port = getAiPort();
  if (!port.pollBatch) return { drafted: 0 };
  const batches = await runAsSystem(() => prisma.aiBatch.findMany({ where: { status: 'PENDING' }, select: { id: true, batchId: true, mapping: true } }));
  let drafted = 0;

  for (const b of batches) {
    let res;
    try { res = await port.pollBatch(b.batchId); } catch (err) { logger.error({ err, batchId: b.batchId }, '[proactive] batch poll failed'); continue; }
    if (!res.ended) continue; // still processing — check again next tick
    const mapping = (b.mapping ?? {}) as unknown as Record<string, BatchMapEntry>;

    for (const r of res.results ?? []) {
      const m = mapping[r.customId];
      if (!m || r.json == null) continue;
      const parsed = NarrativeSchema.safeParse(r.json);
      if (!parsed.success) continue;
      const draft = parsed.data;
      try {
        await runWithTenant(m.tenantId ?? '', async () => {
          const existing = await prisma.aiBriefing.findUnique({
            where: { projectId_period_periodKey: { projectId: r.customId, period: m.period, periodKey: m.periodKey } },
            select: { id: true },
          });
          if (existing) return;
          await recordAiUsage({ feature: 'proactive', model: m.model, usage: r.usage, projectId: r.customId });
          await prisma.aiBriefing.create({
            data: {
              projectId: r.customId, tenantId: m.tenantId, period: m.period, periodKey: m.periodKey, status: 'PENDING',
              execSummary: draft.executiveSummary, highlights: draft.highlights, lowlights: draft.lowlights, nextFocus: draft.nextFocus,
              slipLevel: m.slipLevel, slipScore: m.slipScore, overrunLevel: m.overrunLevel, overrunScore: m.overrunScore,
              model: m.model, generatedAt: new Date(m.generatedAt),
            },
          });
          if (m.pmUserId) {
            await createNotification({ userId: m.pmUserId, type: 'AI_BRIEFING_READY', title: `AI drafted a status update for ${m.code}`, body: `Review the draft narrative for “${m.name}” and apply or dismiss it.`, projectId: r.customId, link: '/reports' });
          }
          drafted++;
        });
      } catch (err) {
        logger.error({ err, projectId: r.customId }, '[proactive] batch finalize failed');
      }
    }
    await runAsSystem(() => prisma.aiBatch.update({ where: { id: b.id }, data: { status: 'DONE', resolvedAt: new Date() } }));
  }
  return { drafted };
}

// Hourly sweep. Fans out over every tenant that opted in (aiProactiveEnabled). Within each, drafts a
// briefing for each active project not yet drafted this period, up to the per-tenant cap. A no-op
// (one cheap query) outside the window or when the AI key is unset. In PROACTIVE_BATCH mode it submits
// one org-wide batch instead (finalised later by finalizeDueBatches).
export async function runProactiveSweepIfDue(now: Date = new Date()): Promise<{ drafted: number; submitted?: number }> {
  if (!aiEnabled()) return { drafted: 0 }; // dormant until the AI key is set
  if (!isProactiveDue(now)) return { drafted: 0 }; // cheapest exit: wrong window

  if (batchEnabled()) {
    const { submitted } = await submitProactiveBatch(now);
    return { drafted: 0, submitted };
  }

  const tenants = await runAsSystem(() =>
    prisma.tenant.findMany({ where: { aiProactiveEnabled: true, status: 'ACTIVE' }, select: { id: true } }),
  );

  let drafted = 0;
  for (const t of tenants) {
    await runWithTenant(t.id, async () => {
      const key = periodKey(now, PERIOD);
      const projects = await prisma.project.findMany({
        where: { deletedAt: null, status: 'IN_PROGRESS' },
        select: { id: true, code: true, name: true, pmUserId: true, tenantId: true },
        take: MAX_PROJECTS_PER_TENANT,
      });
      for (const p of projects) {
        try {
          if (await draftForProject(p, key, now)) drafted++;
        } catch (err) {
          logger.error({ err, projectId: p.id }, '[proactive] draft failed');
        }
      }
    });
  }
  return { drafted };
}

// ---------------------------------------------------------------------------
// Review queries (drive the Reports banner + the portfolio "AI briefings" inbox)
// ---------------------------------------------------------------------------

function briefingView(b: {
  id: string; projectId: string; period: string; periodKey: string;
  execSummary: string | null; highlights: string | null; lowlights: string | null; nextFocus: string | null;
  slipLevel: string | null; slipScore: number | null; overrunLevel: string | null; overrunScore: number | null;
  model: string | null; generatedAt: Date;
}) {
  return {
    id: b.id,
    projectId: b.projectId,
    period: b.period,
    periodKey: b.periodKey,
    execSummary: b.execSummary,
    highlights: b.highlights,
    lowlights: b.lowlights,
    nextFocus: b.nextFocus,
    slip: b.slipLevel ? { level: b.slipLevel, score: b.slipScore ?? 0 } : null,
    overrun: b.overrunLevel ? { level: b.overrunLevel, score: b.overrunScore ?? 0 } : null,
    model: b.model,
    generatedAt: b.generatedAt.toISOString(),
  };
}

// Latest PENDING briefing for a project (drives the Reports banner). null when none.
export async function getPendingBriefing(projectId: string) {
  const b = await prisma.aiBriefing.findFirst({
    where: { projectId, status: 'PENDING' },
    orderBy: { generatedAt: 'desc' },
  });
  return b ? briefingView(b) : null;
}

// The caller's portfolio inbox: PENDING briefings across the projects they can access (same role
// rule as the project list — a non-global role sees only projects they manage).
export async function listMyBriefings(userId: string, role: Role) {
  const projects = await listProjects(userId, role);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ids = [...byId.keys()];
  if (ids.length === 0) return [];
  const briefings = await prisma.aiBriefing.findMany({
    where: { projectId: { in: ids }, status: 'PENDING' },
    orderBy: { generatedAt: 'desc' },
  });
  return briefings.map((b) => {
    const p = byId.get(b.projectId)!;
    return { ...briefingView(b), projectCode: p.code, projectName: p.name };
  });
}

// Resolve a briefing (APPLIED after the PM saves the commentary, or DISMISSED). Stamps the reviewer.
// Idempotent-ish: only a PENDING briefing transitions.
export async function resolveBriefing(
  projectId: string,
  briefingId: string,
  status: 'APPLIED' | 'DISMISSED',
  reviewer: { id: string; name: string },
) {
  const b = await prisma.aiBriefing.findFirst({ where: { id: briefingId, projectId } });
  if (!b) throw NotFound('Briefing not found');
  await prisma.aiBriefing.update({
    where: { id: briefingId },
    data: { status, reviewedById: reviewer.id, reviewedByName: reviewer.name, reviewedAt: new Date() },
  });
  return { status };
}
