// =====================================================================
// EARNED VALUE MANAGEMENT (Integration engine)
// Glues Cost + Schedule + Progress into health metrics.
// =====================================================================
import { round2 } from './money.js';

export interface EvmTask {
  /** Budgeted cost allocated to this task (its share of the cost baseline). */
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

export interface EvmResult {
  bac: number;
  pv: number; // Planned Value
  ev: number; // Earned Value
  ac: number; // Actual Cost
  cv: number; // Cost Variance = EV - AC
  sv: number; // Schedule Variance = EV - PV
  cpi: number; // Cost Performance Index = EV / AC
  spi: number; // Schedule Performance Index = EV / PV
  eac: number; // Estimate at Completion = BAC / CPI
  etc: number; // Estimate to Complete = EAC - AC
  vac: number; // Variance at Completion = BAC - EAC
  tcpi: number; // To-Complete Performance Index = (BAC - EV) / (BAC - AC)
  percentComplete: number; // EV / BAC (0..1)
  health: 'GREEN' | 'AMBER' | 'RED';
}

export function computeEvm(input: EvmInput): EvmResult {
  const bac = round2(input.bac ?? input.tasks.reduce((s, t) => s + (t.budgetCost || 0), 0));
  const ac = round2(input.actualCost || 0);

  let pv = 0;
  let ev = 0;
  for (const t of input.tasks) {
    const budget = t.budgetCost || 0;
    pv += budget * plannedProgress(t, input.statusDate);
    ev += budget * clampPct(t.progressPct);
  }
  pv = round2(pv);
  ev = round2(ev);

  const cv = round2(ev - ac);
  const sv = round2(ev - pv);
  const cpi = ac > 0 ? round4(ev / ac) : 0;
  const spi = pv > 0 ? round4(ev / pv) : 0;
  // EAC = BAC / CPI, but computed from exact EV/AC (= BAC × AC / EV) to avoid
  // compounding the rounding error of a 4-decimal CPI into a money figure.
  const eac = ev > 0 && ac > 0 ? round2((bac * ac) / ev) : bac;
  const etc = round2(eac - ac);
  const vac = round2(bac - eac);
  const tcpi = bac - ac !== 0 ? round4((bac - ev) / (bac - ac)) : 0;
  const percentComplete = bac > 0 ? round4(ev / bac) : 0;

  return {
    bac, pv, ev, ac, cv, sv, cpi, spi, eac, etc, vac, tcpi, percentComplete,
    health: healthFrom(cpi, spi),
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

/** RAG health: GREEN both indices healthy, RED if either is poor, else AMBER. */
function healthFrom(cpi: number, spi: number): 'GREEN' | 'AMBER' | 'RED' {
  const worst = Math.min(cpi || 0, spi || 0);
  if (worst >= 0.95) return 'GREEN';
  if (worst >= 0.85) return 'AMBER';
  return 'RED';
}
