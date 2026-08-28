import { prisma } from '../../lib/prisma.js';
import { runAsSystem, runWithTenant } from '../../lib/tenant/context.js';
import { logger } from '../../lib/observability.js';
import { getProjectForecast } from '../forecast/forecast.service.js';
import { AI_ACTION_TYPES, type AiActionType } from './aiActions.service.js';

// =====================================================================
// Outcome learning — closes the Stage C loop.
//
// When an AiActionProposal is APPLIED we stamp a baseline (SPI/CPI/progress at apply time), wait a
// fixed horizon, then re-measure and classify whether the action's target metric actually moved.
// Aggregated per actionType this becomes an evidence-backed track record Anett can cite honestly
// ("tidy-schedule improved SPI in 3 of the last 4 similar cases").
//
// Deterministic — no LLM, no API spend. Correlational, NOT causal (many things move SPI); every
// surface says so. Naturally dormant: outcomes only accrue where Stage C actions get applied.
// Only metric-moving actions are scored (TIDY_SCHEDULE, UPDATE_TASK_PROGRESS → SPI). CREATE_RISK /
// CREATE_CHANGE_REQUEST are recorded as ADVISORY context only (risk/CR logging doesn't causally
// move an index, so a verdict would mislead).
// =====================================================================

// How long to wait after an action lands before measuring its effect. ~3 weekly EVM snapshots.
export const HORIZON_DAYS = Number(process.env.AI_OUTCOME_HORIZON_DAYS ?? 21) || 21;
const DAY_MS = 24 * 60 * 60 * 1000;

// SPI delta beyond ±this counts as a real move; inside it is noise (UNCHANGED).
const SPI_THRESHOLD = 0.03;

// Hide low-evidence stats: don't present an effectiveness rate until we have at least this many
// MEASURED outcomes for an action type. Shared by the API + client so the floor is consistent.
export const EFFECTIVENESS_MIN_SAMPLE = 3;

// Which action types get a metric verdict, and against which metric.
const SCORED_METRIC: Record<AiActionType, 'SPI' | null> = {
  TIDY_SCHEDULE: 'SPI',
  UPDATE_TASK_PROGRESS: 'SPI',
  CREATE_RISK: null,
  CREATE_CHANGE_REQUEST: null,
};

export type OutcomeVerdict = 'PENDING' | 'IMPROVED' | 'UNCHANGED' | 'WORSENED' | 'INCONCLUSIVE' | 'ADVISORY';

// --- Pure helpers (unit-tested) ------------------------------------------------------------------

// Classify an SPI delta into a verdict. `null` when a usable reading was missing at either end.
export function classifyDelta(delta: number | null, threshold = SPI_THRESHOLD): OutcomeVerdict {
  if (delta == null || !Number.isFinite(delta)) return 'INCONCLUSIVE';
  if (delta >= threshold) return 'IMPROVED';
  if (delta <= -threshold) return 'WORSENED';
  return 'UNCHANGED';
}

export interface OutcomeRow { actionType: string; verdict: string; spiDelta: number | null }
export interface ActionStat {
  actionType: string;
  measured: number;   // IMPROVED + UNCHANGED + WORSENED (the scored, resolvable outcomes)
  improved: number;
  unchanged: number;
  worsened: number;
  improvedRate: number | null; // improved / measured, or null below the sample floor
  avgSpiDelta: number | null;
  sampleSize: number;          // == measured (alias for the UI's "N")
}

// Aggregate measured outcome rows into a per-actionType track record.
export function aggregate(rows: OutcomeRow[]): ActionStat[] {
  const by = new Map<string, OutcomeRow[]>();
  for (const r of rows) {
    if (!['IMPROVED', 'UNCHANGED', 'WORSENED'].includes(r.verdict)) continue;
    (by.get(r.actionType) ?? by.set(r.actionType, []).get(r.actionType)!).push(r);
  }
  const out: ActionStat[] = [];
  for (const [actionType, rs] of by) {
    const measured = rs.length;
    const improved = rs.filter((r) => r.verdict === 'IMPROVED').length;
    const unchanged = rs.filter((r) => r.verdict === 'UNCHANGED').length;
    const worsened = rs.filter((r) => r.verdict === 'WORSENED').length;
    const deltas = rs.map((r) => r.spiDelta).filter((d): d is number => d != null && Number.isFinite(d));
    const avgSpiDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    out.push({
      actionType, measured, improved, unchanged, worsened,
      improvedRate: measured >= EFFECTIVENESS_MIN_SAMPLE ? improved / measured : null,
      avgSpiDelta,
      sampleSize: measured,
    });
  }
  return out.sort((a, b) => b.measured - a.measured);
}

// --- Live metric reading -------------------------------------------------------------------------

interface Metrics { spi: number | null; cpi: number | null; progress: number | null }

// SPI/CPI/progress from the live forecast at a point in time. Best-effort: a missing/deleted project
// or an un-baselined one (no PV) yields nulls, which downstream turns into INCONCLUSIVE.
async function metricsAsOf(projectId: string, asOf: Date): Promise<Metrics> {
  try {
    const f = await getProjectForecast(projectId, asOf);
    const usable = f.hasData && f.pv > 0; // SPI = EV/PV is only meaningful once PV exists
    return {
      spi: usable ? f.spi : null,
      cpi: f.hasData && f.ac > 0 ? f.cpi : null,
      progress: f.bac > 0 ? f.ev / f.bac : null,
    };
  } catch (err) {
    logger.warn({ err, projectId }, '[ai-outcome] metricsAsOf failed');
    return { spi: null, cpi: null, progress: null };
  }
}

// --- Baseline (called from finalizeProposal on APPLIED) ------------------------------------------

// Stamp the at-apply-time baseline and schedule the measurement. Best-effort: MUST NOT throw into
// the approval finalize path. Runs inside the approver's tenant context, so the scope extension
// stamps tenantId on create. Idempotent-ish via the proposalId unique constraint.
export async function recordBaseline(proposal: { id: string; actionType: string; projectId: string }, appliedAt: Date = new Date()): Promise<void> {
  try {
    const scored = SCORED_METRIC[proposal.actionType as AiActionType] != null;
    const m = await metricsAsOf(proposal.projectId, appliedAt);
    await prisma.aiActionOutcome.create({
      data: {
        projectId: proposal.projectId,
        proposalId: proposal.id,
        actionType: proposal.actionType,
        scored,
        appliedAt,
        evalDueAt: new Date(appliedAt.getTime() + HORIZON_DAYS * DAY_MS),
        spiBefore: m.spi,
        cpiBefore: m.cpi,
        progressBefore: m.progress,
        // Unscored actions are context-only: record the baseline but never chase a verdict.
        verdict: scored ? 'PENDING' : 'ADVISORY',
      },
    });
  } catch (err) {
    logger.error({ err, proposalId: proposal.id }, '[ai-outcome] recordBaseline failed');
  }
}

// --- Measurement sweep ---------------------------------------------------------------------------

// Resolve every PENDING outcome whose horizon has elapsed. Reads across all tenants (runAsSystem),
// then measures each inside its own tenant context so the forecast's scoped reads are correct.
// Idempotent: only PENDING rows are touched. Cheap when nothing is due (one indexed query).
export async function measureDueOutcomes(now: Date = new Date()): Promise<{ measured: number }> {
  const due = await runAsSystem(() =>
    prisma.aiActionOutcome.findMany({
      where: { verdict: 'PENDING', evalDueAt: { lte: now } },
      select: { id: true, tenantId: true, projectId: true, evalDueAt: true, spiBefore: true },
      take: 500,
    }),
  );
  if (!due.length) return { measured: 0 };

  // Group by tenant so we enter each tenant context once.
  const byTenant = new Map<string | null, typeof due>();
  for (const o of due) (byTenant.get(o.tenantId) ?? byTenant.set(o.tenantId, []).get(o.tenantId)!).push(o);

  let measured = 0;
  for (const [tenantId, rows] of byTenant) {
    const run = tenantId ? <T>(fn: () => Promise<T>) => runWithTenant(tenantId, fn) : runAsSystem;
    await run(async () => {
      for (const o of rows) {
        try {
          // Measure AT the due date (stable/reproducible) rather than "now" (which may lag).
          const after = await metricsAsOf(o.projectId, o.evalDueAt);
          const delta = o.spiBefore != null && after.spi != null ? after.spi - o.spiBefore : null;
          const verdict = classifyDelta(delta);
          await prisma.aiActionOutcome.update({
            where: { id: o.id },
            data: {
              spiAfter: after.spi, cpiAfter: after.cpi, progressAfter: after.progress,
              spiDelta: delta, measuredAt: now, verdict,
            },
          });
          measured++;
        } catch (err) {
          logger.error({ err, outcomeId: o.id }, '[ai-outcome] measure failed');
        }
      }
    });
  }
  return { measured };
}

// --- Read models (drive the surfaces; run in the caller's tenant context → auto-scoped) ----------

// Per-actionType effectiveness for the current tenant scope (optionally one project).
export async function getActionEffectiveness(opts: { projectId?: string } = {}): Promise<ActionStat[]> {
  const rows = await prisma.aiActionOutcome.findMany({
    where: {
      scored: true,
      verdict: { in: ['IMPROVED', 'UNCHANGED', 'WORSENED'] },
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
    },
    select: { actionType: true, verdict: true, spiDelta: true },
    take: 2000,
  });
  return aggregate(rows);
}

// Recent measured outcomes for the admin card (project + action + ΔSPI + verdict).
export async function listRecentOutcomes(opts: { take?: number } = {}) {
  return prisma.aiActionOutcome.findMany({
    where: { verdict: { in: ['IMPROVED', 'UNCHANGED', 'WORSENED'] } },
    orderBy: { measuredAt: 'desc' },
    take: Math.min(Math.max(opts.take ?? 20, 1), 100),
    select: {
      id: true, actionType: true, verdict: true, spiBefore: true, spiAfter: true, spiDelta: true,
      appliedAt: true, measuredAt: true,
      project: { select: { code: true, name: true } },
    },
  });
}

export { AI_ACTION_TYPES };
