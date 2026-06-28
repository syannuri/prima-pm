// =====================================================================
// Cost roll-up orchestrator (PURE) — composes the calc primitives so the
// CostBaseline can be recomputed deterministically and unit-tested without DB.
// =====================================================================
import {
  directTotal,
  indirectTotal,
  rollupCost,
  type DirectCostLine,
  type IndirectCostLine,
  type RollupResult,
} from '../../calc/cost.js';
import {
  contingencyReserve,
  type RiskForReserve,
  type ContingencyOptions,
  type ContingencyResult,
} from '../../calc/risk.js';

export interface BaselineComputationInput {
  directLines: DirectCostLine[];
  indirectLines: IndirectCostLine[];
  risks: RiskForReserve[];
  managementReserve?: number;
  contingencyOptions?: ContingencyOptions;
}

export interface BaselineComputationResult extends RollupResult {
  contingencyBreakdown: ContingencyResult;
}

/**
 * Single source of truth for the project budget roll-up:
 *   directTotal + indirectTotal + contingency(Σ residual EMV) [+ mgmt reserve = BAC]
 */
export function computeBaseline(input: BaselineComputationInput): BaselineComputationResult {
  const dt = directTotal(input.directLines);
  const it = indirectTotal(input.indirectLines);
  const contingency = contingencyReserve(input.risks, input.contingencyOptions);

  const roll = rollupCost({
    directTotal: dt,
    indirectTotal: it,
    contingencyReserve: contingency.contingencyReserve,
    managementReserve: input.managementReserve,
  });

  return { ...roll, contingencyBreakdown: contingency };
}
