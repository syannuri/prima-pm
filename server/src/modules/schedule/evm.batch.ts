import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { evmFromRows, type EvmTaskRow, type PredictiveEvm } from './schedule.service.js';
import { getAgileEvm, getHybridEvm } from '../agile/agile.service.js';

const dec = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : Number(v);

// Static predictive-EVM inputs for one project, WITHOUT the status-date-dependent parts
// (actualCost / statusDate). Loaded in bulk so the same rows can be reused across many
// projects (portfolio) or many status dates (S-curve) with no re-query.
interface StaticEvmRows {
  tasks: EvmTaskRow[];
  costByTask: Map<string, number>;
  scheduleBaselinedAt: Date | null;
  costBaselineBAC: number;
}

// Batch-load the static predictive EVM inputs for many projects in a FIXED number of
// queries (4 total), instead of ~4 queries PER project as getEvm() does one-at-a-time.
// The per-project grouping mirrors directCostByTask() exactly (value = amount ?? manpowerCost)
// so evmFromRows() produces byte-identical numbers to the single-project getEvm() path.
async function loadStaticRows(ids: string[]): Promise<Map<string, StaticEvmRows>> {
  const out = new Map<string, StaticEvmRows>();
  if (ids.length === 0) return out;

  const [taskRows, costRows, projs, baselines] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: { in: ids } },
      select: { id: true, projectId: true, parentTaskId: true, planStart: true, planEnd: true, progressPct: true, baselineStart: true, baselineFinish: true },
    }),
    prisma.costItemDirect.findMany({
      where: { projectId: { in: ids }, taskId: { not: null } },
      select: { projectId: true, taskId: true, amount: true, manpowerCost: true },
    }),
    prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, scheduleBaselinedAt: true } }),
    prisma.costBaseline.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, costBaseline: true } }),
  ]);

  const tasksByProject = new Map<string, EvmTaskRow[]>();
  for (const t of taskRows) {
    let arr = tasksByProject.get(t.projectId);
    if (!arr) tasksByProject.set(t.projectId, (arr = []));
    arr.push({ id: t.id, parentTaskId: t.parentTaskId, planStart: t.planStart, planEnd: t.planEnd, progressPct: t.progressPct, baselineStart: t.baselineStart, baselineFinish: t.baselineFinish });
  }

  const costByProject = new Map<string, Map<string, number>>();
  for (const c of costRows) {
    let m = costByProject.get(c.projectId);
    if (!m) costByProject.set(c.projectId, (m = new Map<string, number>()));
    const value = c.amount != null ? dec(c.amount) : dec(c.manpowerCost);
    m.set(c.taskId!, (m.get(c.taskId!) ?? 0) + value);
  }

  const baselinedAt = new Map(projs.map((p) => [p.id, p.scheduleBaselinedAt] as const));
  const bacByProject = new Map(baselines.map((b) => [b.projectId, dec(b.costBaseline)] as const));

  for (const id of ids) {
    out.set(id, {
      tasks: tasksByProject.get(id) ?? [],
      costByTask: costByProject.get(id) ?? new Map<string, number>(),
      scheduleBaselinedAt: baselinedAt.get(id) ?? null,
      costBaselineBAC: bacByProject.get(id) ?? 0,
    });
  }
  return out;
}

// Cumulative Actual Cost (≤ statusDate) for many projects in ONE aggregate query.
// Mirrors actualCostAsOf() summed per project.
async function actualCostAsOfBatch(ids: string[], statusDate: Date): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const agg = await prisma.actualCostEntry.groupBy({
    by: ['projectId'],
    where: { projectId: { in: ids }, date: { lte: statusDate } },
    _sum: { amount: true },
  });
  for (const a of agg) map.set(a.projectId, dec(a._sum.amount));
  return map;
}

type ProjectEvm = PredictiveEvm | Awaited<ReturnType<typeof getAgileEvm>>;

/**
 * EVM for MANY projects at one status date, methodology-aware, returned as a Map keyed by
 * project id. DRAFT projects are omitted (they have no baseline yet — matches the old
 * per-project skip). Predictive projects are loaded in bulk (a handful of queries total)
 * and evaluated in memory via evmFromRows; AGILE/HYBRID delegate to their existing points
 * dispatchers (the minority — kept per-project so their blended math is untouched).
 *
 * Replaces portfolio-summary's O(projects × ~5) query fan-out on the predictive path.
 */
export async function computeEvmForProjects(
  projects: { id: string; status: string; deliveryApproach: string }[],
  statusDate: Date,
): Promise<Map<string, ProjectEvm>> {
  const result = new Map<string, ProjectEvm>();

  const active = projects.filter((p) => p.status !== 'DRAFT');
  const predictiveIds = active.filter((p) => p.deliveryApproach !== 'AGILE' && p.deliveryApproach !== 'HYBRID').map((p) => p.id);
  const otherProjects = active.filter((p) => p.deliveryApproach === 'AGILE' || p.deliveryApproach === 'HYBRID');

  const [rowsById, acById, others] = await Promise.all([
    loadStaticRows(predictiveIds),
    actualCostAsOfBatch(predictiveIds, statusDate),
    Promise.all(
      otherProjects.map((p) =>
        (p.deliveryApproach === 'AGILE'
          ? getAgileEvm(p.id, undefined, statusDate)
          : getHybridEvm(p.id, undefined, statusDate)
        ).then((evm) => [p.id, evm] as const),
      ),
    ),
  ]);

  for (const id of predictiveIds) {
    const rows = rowsById.get(id)!;
    result.set(id, evmFromRows({ ...rows, actualCost: acById.get(id) ?? 0, statusDate }));
  }
  for (const [id, evm] of others) result.set(id, evm);

  return result;
}

/**
 * Planned-Value (PV) series for ONE project resampled at many status dates — the EVM S-curve.
 * For a PREDICTIVE project the static WBS/cost rows are loaded ONCE and PV is evaluated in
 * memory per date (AC is irrelevant to PV, so no per-date AC lookup), collapsing up to ~53 DB
 * round-trips into a single load. AGILE/HYBRID fall back to the per-date methodology dispatcher
 * (points/blended PV isn't a pure function of already-loaded WBS rows).
 *
 * `dates` are epoch-ms marks; the returned array is PV aligned to `dates` by index.
 */
export async function evmPvSeries(projectId: string, dates: number[]): Promise<number[]> {
  if (dates.length === 0) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { deliveryApproach: true } });
  const approach = project?.deliveryApproach;

  if (approach === 'AGILE' || approach === 'HYBRID') {
    const { getProjectEvm } = await import('../agile/agile.service.js');
    return Promise.all(dates.map((d) => getProjectEvm(projectId, 0, new Date(d)).then((e) => e.pv)));
  }

  const rows = (await loadStaticRows([projectId])).get(projectId);
  if (!rows) return dates.map(() => 0);
  return dates.map((d) => evmFromRows({ ...rows, actualCost: 0, statusDate: new Date(d) }).pv);
}
