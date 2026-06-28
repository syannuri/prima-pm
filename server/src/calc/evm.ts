// =====================================================================
// EARNED VALUE MANAGEMENT (Integration engine)
// Glues Cost + Schedule + Progress into health metrics.
// =====================================================================
import { round2 } from './money.js';

export interface EvmTask {
  /**
   * Relative weight used to distribute the budget and roll up progress —
   * a task's share of the cost baseline (cost-loaded EVM) or a proxy such as
   * duration when no cost is loaded. Field name kept as `budgetCost` for
   * back-compat; semantically it is the work-package WEIGHT (>= 0).
   */
  budgetCost: number;
  /** Actual % complete, 0..100. */
  progressPct: number;
  planStart: Date;
  planEnd: Date;
}

/** Planned % complete for a task at `statusDate`, linear over its planned window. */
export function plannedProgress(task: EvmTask, statusDate: Date): number {
  const start = task.planStart.getTime();
  const end = task.planEnd.getTime();
  const now = statusDate.getTime();
  if (now <= start) return 0;
  if (now >= end || end <= start) return now >= end ? 1 : 0;
  return (now - start) / (end - start);
}

export interface EvmInput {
  tasks: EvmTask[];
  /** Budget at Completion (from cost roll-up). If omitted, derived from Σ budgetCost. */
  bac?: number;
  /** Actual Cost incurred to date (manual entry in MVP). */
  actualCost: number;
  statusDate: Date;
}

export type EvmHealth = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';

export interface EvmResult {
  bac: number;
  pv: number; // Planned Value (BCWS)
  ev: number; // Earned Value (BCWP)
  ac: number; // Actual Cost (ACWP)
  cv: number; // Cost Variance = EV - AC
  sv: number; // Schedule Variance = EV - PV
  cpi: number; // Cost Performance Index = EV / AC (0 = no actual cost yet)
  spi: number; // Schedule Performance Index = EV / PV (0 = not started)
  eac: number; // Estimate at Completion
  etc: number; // Estimate to Complete = EAC - AC
  vac: number; // Variance at Completion = BAC - EAC
  tcpi: number; // To-Complete Performance Index = (BAC - EV) / (BAC - AC)
  percentComplete: number; // EV / BAC (0..1) — money-based; 0 when BAC unknown
  weightedProgress: number; // Σ(weight·%) / Σweight (0..1) — physical progress, valid even when BAC = 0
  health: EvmHealth;
}

export function computeEvm(input: EvmInput): EvmResult {
  // Σ of work-package weights. Budgets are distributed pro-rata to weights so
  // that Σ(task budget) == BAC (the EVM "100% rule"), keeping EV/PV in real money.
  const totalWeight = input.tasks.reduce((s, t) => s + Math.max(0, t.budgetCost || 0), 0);
  const bac = round2(input.bac ?? totalWeight);
  const ac = round2(input.actualCost || 0);
  const scale = totalWeight > 0 ? bac / totalWeight : 0; // weight → money

  let pv = 0;
  let ev = 0;
  let weightedDone = 0; // Σ(weight · %done), for BAC-independent physical progress
  for (const t of input.tasks) {
    const w = Math.max(0, t.budgetCost || 0);
    const done = clampPct(t.progressPct);
    pv += w * scale * plannedProgress(t, input.statusDate);
    ev += w * scale * done;
    weightedDone += w * done;
  }
  pv = round2(pv);
  ev = round2(ev);
  const weightedProgress = totalWeight > 0 ? round4(weightedDone / totalWeight) : 0;

  const hasCost = ac > 0;
  const hasSchedule = pv > 0;
  const cv = round2(ev - ac);
  const sv = round2(ev - pv);
  const cpi = hasCost ? round4(ev / ac) : 0;
  const spi = hasSchedule ? round4(ev / pv) : 0;

  // EAC: performance-adjusted (BAC/CPI) when we have both EV & AC; if cost has been
  // incurred with ~no earned value, project AC + remaining budget (don't hide the
  // overrun by falling back to BAC); otherwise nothing spent yet → EAC = BAC.
  // BAC × AC / EV == AC + (BAC - EV)/CPI, but avoids re-introducing CPI's rounding.
  let eac: number;
  if (ev > 0 && ac > 0) eac = round2((bac * ac) / ev);
  else if (ac > 0) eac = round2(ac + (bac - ev));
  else eac = bac;
  const etc = round2(eac - ac);
  const vac = round2(bac - eac);
  const tcpi = bac - ac !== 0 ? round4((bac - ev) / (bac - ac)) : 0;
  const percentComplete = bac > 0 ? round4(ev / bac) : 0;

  return {
    bac, pv, ev, ac, cv, sv, cpi, spi, eac, etc, vac, tcpi,
    percentComplete, weightedProgress,
    health: healthFrom(cpi, spi, hasCost, hasSchedule),
  };
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 100) return 1;
  return p / 100;
}

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

/**
 * RAG health from the WORST of the *available* indices. CPI needs recorded
 * Actual Cost; SPI needs a started plan (PV > 0). With neither available we
 * have nothing to judge → NO_DATA (instead of a misleading RED).
 */
function healthFrom(cpi: number, spi: number, hasCost: boolean, hasSchedule: boolean): EvmHealth {
  const indices: number[] = [];
  if (hasSchedule) indices.push(spi);
  if (hasCost) indices.push(cpi);
  if (indices.length === 0) return 'NO_DATA';
  const worst = Math.min(...indices);
  if (worst >= 0.95) return 'GREEN';
  if (worst >= 0.85) return 'AMBER';
  return 'RED';
}
