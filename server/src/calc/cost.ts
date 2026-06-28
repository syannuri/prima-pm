// =====================================================================
// COST MANAGEMENT calculations (Module 2)
// Pure functions — no DB. Inputs are plain numbers/objects.
// =====================================================================
import { round2, sumMoney } from './money.js';

// --- Line-level ---

/** Material line: amount = qty * unitCost */
export function materialAmount(qty: number, unitCost: number): number {
  return round2((qty || 0) * (unitCost || 0));
}

/** Manpower line: cost = unitCostPerManday * planMandays */
export function manpowerCost(unitCostPerManday: number, planMandays: number): number {
  return round2((unitCostPerManday || 0) * (planMandays || 0));
}

// --- Totals ---

export interface DirectCostLine {
  // For material lines provide `amount`; for manpower lines provide `manpowerCost`.
  amount?: number | null;
  manpowerCost?: number | null;
}

/** Direct Cost Total = Σ material amounts + Σ manpower costs */
export function directTotal(lines: DirectCostLine[]): number {
  return sumMoney(lines.map((l) => l.amount ?? l.manpowerCost ?? 0));
}

export interface IndirectCostLine {
  amount: number;
}

/** Indirect Cost Total = Σ indirect amounts (transport, accommodation, entertainment) */
export function indirectTotal(lines: IndirectCostLine[]): number {
  return sumMoney(lines.map((l) => l.amount));
}

// --- Roll-up / Baseline ---

export interface RollupInput {
  directTotal: number;
  indirectTotal: number;
  contingencyReserve: number; // from Risk module (Module 3)
  managementReserve?: number; // optional policy reserve
}

export interface RollupResult {
  directTotal: number;
  indirectTotal: number;
  contingencyReserve: number;
  managementReserve: number;
  /** Cost Baseline = direct + indirect + contingency */
  costBaseline: number;
  /** Budget at Completion = cost baseline + management reserve */
  budgetAtCompletion: number;
}

export function rollupCost(input: RollupInput): RollupResult {
  const managementReserve = round2(input.managementReserve ?? 0);
  const costBaseline = sumMoney([
    input.directTotal,
    input.indirectTotal,
    input.contingencyReserve,
  ]);
  const budgetAtCompletion = sumMoney([costBaseline, managementReserve]);
  return {
    directTotal: round2(input.directTotal),
    indirectTotal: round2(input.indirectTotal),
    contingencyReserve: round2(input.contingencyReserve),
    managementReserve,
    costBaseline,
    budgetAtCompletion,
  };
}

// --- Charter vs Baseline variance ---

export interface VarianceResult {
  highLevelCost: number;
  baselineCost: number;
  variance: number; // baseline - highLevel (positive = over the charter estimate)
  variancePct: number; // relative to highLevel
  isOverrun: boolean;
}

/** Compare committed high-level charter cost against the detailed baseline. */
export function charterVariance(highLevelCost: number, baselineCost: number): VarianceResult {
  const variance = round2(baselineCost - highLevelCost);
  const variancePct = highLevelCost ? round2((variance / highLevelCost) * 100) : 0;
  return {
    highLevelCost: round2(highLevelCost),
    baselineCost: round2(baselineCost),
    variance,
    variancePct,
    isOverrun: variance > 0,
  };
}
