// Single source of truth for profit / margin so the dashboard, project Overview, forecast and
// report never drift. Conventions (agreed in the PMO/QA review):
//   • Plan cost   = BAC (the cost-baseline PMB: direct + indirect + contingency) — NOT the free-text
//     Project.costBaselineIdr, which is only a charter-time estimate.
//   • Plan profit = Revenue − BAC.
//   • Projected profit = Revenue − EAC (forecast at completion) — the honest "where margin will land".
//     "Revenue − AC" (cost-to-date) is deliberately NOT used as a profit: mid-project it looks inflated.
export interface Margin {
  profit: number;
  marginPct: number | null; // null when revenue is 0
}

export function computeMargin(revenue: number, cost: number): Margin {
  const profit = revenue - cost;
  return { profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : null };
}

export function marginPctText(m: Margin): string {
  return m.marginPct != null ? `${m.marginPct.toFixed(1)}%` : '—';
}

// Likely Estimate at Completion (BAC ÷ CPI); falls back to BAC when there is no cost performance yet.
export function likelyEac(bac: number, cpi: number): number {
  return cpi > 0 ? bac / cpi : bac;
}
