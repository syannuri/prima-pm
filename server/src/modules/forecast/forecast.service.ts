import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
// Use the methodology dispatcher (AGILE → points-EVM, HYBRID → blended, else → WBS) so the
// Forecast tab reports the SAME EVM as the Dashboard/Portfolio. Calling the WBS-only getEvm
// here made agile/hybrid projects show BAC/EV/CPI/SPI ≈ 0 on Forecast while other surfaces
// used story-point EVM.
import { getProjectEvm } from '../agile/agile.service.js';
import { evmPvSeries } from '../schedule/evm.batch.js';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
// Margin % = profit ÷ revenue × 100, to 1 dp. Null when there's no revenue to divide by
// (avoids a divide-by-zero reading as 0% and hides the "no contract value" case).
const pct = (profit: number, revenue: number): number | null =>
  revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null;

/**
 * The three EAC scenarios from different assumptions, clamped to a guaranteed
 * best ≤ likely ≤ worst band. They are NOT inherently ordered: when the project runs UNDER budget
 * (CPI>1) the "remaining-at-plan" figure exceeds the trend figure, so a naive best=plan-revert /
 * worst=trend labelling would show "best case" as the MORE expensive number. `likely` stays the
 * canonical BAC/CPI (also used by margin.projected); optimistic/pessimistic are the min/max.
 */
export function eacScenarios(bac: number, ev: number, ac: number, cpi: number, spi: number) {
  const eacPlanRest = ac + (bac - ev);                          // remaining work reverts to plan
  const eacTrend = cpi > 0 ? bac / cpi : bac;                   // current cost trend continues
  const scpi = cpi * spi;
  const eacBoth = scpi > 0 ? ac + (bac - ev) / scpi : eacTrend; // cost + schedule drag both continue
  return {
    optimistic: r2(Math.min(eacPlanRest, eacTrend, eacBoth)),
    likely: r2(eacTrend),
    pessimistic: r2(Math.max(eacPlanRest, eacTrend, eacBoth)),
  };
}

// Project-level EVM forecast: EAC scenarios, schedule/date forecast, projected
// margin and an S-curve (planned PV, actual AC to date, forecast cost to EAC).
export async function getProjectForecast(projectId: string, statusDate: Date) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { totalRevenueIdr: true, baselineLockedAt: true },
  });
  if (!project) throw NotFound('Project not found');

  const [evm, charter, tasks, actuals, pendingCr] = await Promise.all([
    getProjectEvm(projectId, undefined, statusDate),
    prisma.projectCharter.findUnique({ where: { projectId }, select: { hiScheduleStart: true, hiScheduleEnd: true } }),
    prisma.task.findMany({ where: { projectId }, select: { planStart: true, planEnd: true } }),
    prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' }, select: { date: true, amount: true } }),
    // Baseline-staleness signal for the profit numbers: an APPROVED change that raises
    // revenue and/or adds cost (chargeable, or COST/SCHEDULE impact) whose cost side may not
    // yet be reflected in the (re-locked) cost baseline. A chargeable CR bumps Total Revenue
    // on approval, but BAC only moves when the PM re-plans & re-locks — so between the two the
    // projected profit is overstated. We treat a lock as "stale" if a qualifying CR was decided
    // after the last lock (or the baseline is currently unlocked → null lock counts as older).
    prisma.changeRequest.findFirst({
      where: {
        projectId,
        status: 'APPROVED',
        OR: [{ impactAreas: { hasSome: ['COST', 'SCHEDULE'] } }, { chargeable: true }],
        ...(project.baselineLockedAt ? { decidedAt: { gt: project.baselineLockedAt } } : {}),
      },
      orderBy: { decidedAt: 'desc' },
      select: { title: true, decidedAt: true },
    }),
  ]);

  const { bac, ev, ac, cpi, spi } = evm;

  // --- EAC scenarios (best ≤ likely ≤ worst) ---
  const { optimistic, likely, pessimistic } = eacScenarios(bac, ev, ac, cpi, spi);

  // --- Planned window (schedule tasks, else charter high-level dates) ---
  const plannedStart = tasks.length ? Math.min(...tasks.map((t) => +t.planStart)) : charter ? +charter.hiScheduleStart : null;
  const plannedFinish = tasks.length ? Math.max(...tasks.map((t) => +t.planEnd)) : charter ? +charter.hiScheduleEnd : null;

  // --- Schedule/date forecast: SPI stretches the planned duration ---
  let forecastFinish: number | null = null;
  let varianceDays: number | null = null;
  if (plannedStart != null && plannedFinish != null && spi > 0) {
    forecastFinish = Math.round(plannedStart + (plannedFinish - plannedStart) / spi);
    varianceDays = Math.round((forecastFinish - plannedFinish) / DAY);
  }

  const revenue = project.totalRevenueIdr == null ? 0 : Number(project.totalRevenueIdr);
  // Distinguish "no contract value entered" from a genuine zero/loss: with no revenue set,
  // margin = −cost would paint every un-priced project as a catastrophic loss. Gate on this.
  const hasRevenue = revenue > 0;
  const hasData = ac > 0 || ev > 0;

  // --- S-curve: planned PV per date + cumulative AC to date + forecast line to EAC ---
  const acAsOf = (d: number) => actuals.reduce((s, e) => s + (+e.date <= d ? Number(e.amount) : 0), 0);
  const sCurve: { t: string; pv: number; ac: number | null; forecast: number | null }[] = [];
  if (plannedStart != null && plannedFinish != null) {
    const now = +statusDate;
    const end = Math.max(plannedFinish, forecastFinish ?? plannedFinish);
    const N = 10;
    const marks = new Set<number>([now, plannedFinish, ...(forecastFinish ? [forecastFinish] : [])]);
    for (let i = 0; i <= N; i++) marks.add(Math.round(plannedStart + ((end - plannedStart) * i) / N));
    const dates = [...marks].filter((d) => d >= plannedStart && d <= end).sort((a, b) => a - b);
    // PV per methodology (points-based for agile); batched (predictive loads WBS/cost rows once
    // and evaluates each date in memory). Identical to getProjectEvm(projectId, 0, d).pv.
    const pvs = await evmPvSeries(projectId, dates);
    // The forecast cost line runs from today's AC up to the likely EAC. It ends at the forecast
    // finish when schedule performance is known (SPI>0); otherwise fall back to the planned finish
    // so a project with cost recorded but no schedule signal still gets a cost projection.
    const fcEnd = forecastFinish ?? (plannedFinish != null && plannedFinish > now ? plannedFinish : null);
    dates.forEach((d, i) => {
      const forecast = fcEnd != null && fcEnd > now && d >= now
        ? r2(ac + (likely - ac) * ((d - now) / (fcEnd - now)))
        : null;
      sCurve.push({ t: new Date(d).toISOString(), pv: r2(pvs[i]), ac: d <= now ? r2(acAsOf(d)) : null, forecast });
    });
  }

  return {
    statusDate: statusDate.toISOString(),
    bac, ev, ac, pv: evm.pv, cpi, spi, etc: evm.etc, vac: evm.vac, tcpi: evm.tcpi,
    eac: { optimistic, likely, pessimistic },
    schedule: {
      plannedStart: plannedStart != null ? new Date(plannedStart).toISOString() : null,
      plannedFinish: plannedFinish != null ? new Date(plannedFinish).toISOString() : null,
      forecastFinish: forecastFinish != null ? new Date(forecastFinish).toISOString() : null,
      varianceDays,
    },
    // Profit = revenue − forecast cost at completion. Reported as a BAND (best/likely/worst
    // mirror the EAC scenarios: lower EAC → higher profit) with margin % alongside the absolute
    // figures. All null when no contract value is set (see hasRevenue) so the UI shows "—"
    // instead of a false loss. `pct` = profit ÷ revenue × 100 — the erosion measure a cost
    // controller reads on large contracts. Gross, pre-tax/financing/reserve.
    margin: {
      revenue,
      hasRevenue,
      planned: r2(revenue - bac),
      projected: r2(revenue - likely),
      projectedBest: r2(revenue - optimistic),
      projectedWorst: r2(revenue - pessimistic),
      plannedPct: pct(revenue - bac, revenue),
      projectedPct: pct(revenue - likely, revenue),
      projectedWorstPct: pct(revenue - pessimistic, revenue),
    },
    // True while an approved chargeable/cost change hasn't been folded into a re-locked baseline:
    // revenue has moved but BAC may not have, so treat the projected profit as provisional.
    baselineUpdatePending: !!pendingCr,
    pendingChangeTitle: pendingCr?.title ?? null,
    hasData,
    sCurve,
  };
}
