// Cash-flow / time-phased budget service.
//
// Turns the project's cost baseline into a period-by-period cash-flow: PLANNED outflow (BCWS,
// via the batched PV series), ACTUAL outflow (AC entries), FORECAST cash need (remaining EAC
// spread over the future planned shape) and COMMITTED cost (procurement POs by need-date), plus a
// cumulative S-curve. Read-only, deterministic, no persistence — a reporting view over data the
// Cost/Forecast/Procurement modules already own.
import { prisma } from '../../lib/prisma.js';
import { getProjectForecast } from '../forecast/forecast.service.js';
import { evmPvSeries } from '../schedule/evm.batch.js';
import { enumeratePeriods, assembleCashflow, type Granularity, type Period } from './cashflow.periods.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function getCashflow(projectId: string, granularity: Granularity, statusDate: Date) {
  const fc = await getProjectForecast(projectId, statusDate); // throws NotFound for a bad project

  const startIso = fc.schedule.plannedStart;
  const finishIso = fc.schedule.plannedFinish;
  const nowMs = +statusDate;

  // No planned window (no schedule tasks and no charter high-level dates) → nothing to time-phase.
  if (!startIso || !finishIso) {
    return {
      hasData: false,
      granularity,
      statusDate: statusDate.toISOString(),
      window: null,
      summary: { bac: fc.bac, acToDate: fc.ac, eacLikely: fc.eac.likely, remaining: 0, totalCommitted: 0 },
      periods: [],
    };
  }

  const windowStartMs = +new Date(startIso);
  const forecastFinishMs = fc.schedule.forecastFinish ? +new Date(fc.schedule.forecastFinish) : 0;
  // Extend the window to cover a slipped forecast finish and the status date, so future cash need
  // and any spend logged past the plan are still shown.
  const windowEndMs = Math.max(+new Date(finishIso), forecastFinishMs, nowMs);

  const periods = enumeratePeriods(windowStartMs, windowEndMs, granularity);
  const lastPeriodEndMs = periods[periods.length - 1].endMs;

  // --- Planned value: sample cumulative PV at every date assembleCashflow will ask about ---
  const sampleSet = new Set<number>([windowStartMs, windowEndMs, nowMs]);
  for (const p of periods) {
    sampleSet.add(p.startMs);
    sampleSet.add(p.endMs);
  }
  const sampleDates = [...sampleSet].sort((a, b) => a - b);
  const pvVals = await evmPvSeries(projectId, sampleDates);
  const pvMap = new Map<number, number>(sampleDates.map((d, i) => [d, pvVals[i]]));
  const pvAt = (ms: number): number => {
    const hit = pvMap.get(ms);
    if (hit != null) return hit;
    // Fallback (shouldn't happen — every query lands on a sampled boundary): nearest sample ≤ ms.
    let val = pvVals[0] ?? 0;
    for (let i = 0; i < sampleDates.length; i++) {
      if (sampleDates[i] <= ms) val = pvVals[i];
      else break;
    }
    return val;
  };

  // --- Actual cost: cumulative AC as of a date, from the time-phased AC entries ---
  const actuals = await prisma.actualCostEntry.findMany({
    where: { projectId },
    orderBy: { date: 'asc' },
    select: { date: true, amount: true },
  });
  const acAt = (ms: number): number => {
    let s = 0;
    for (const e of actuals) {
      if (+e.date <= ms) s += Number(e.amount);
      else break;
    }
    return s;
  };

  // --- Committed cost: obligated POs (AWARDED / IN_PROGRESS / DELIVERED — same definition as the
  // Cost tab's committed roll-up; PLANNED/SOLICITATION aren't committed yet, CLOSED/CANCELLED
  // don't count), bucketed by need-date ---
  const procs = await prisma.procurement.findMany({
    where: { projectId, status: { in: ['AWARDED', 'IN_PROGRESS', 'DELIVERED'] }, amount: { not: null } },
    select: { amount: true, needBy: true, startDate: true, endDate: true, createdAt: true },
  });
  // Clamp each PO's date into the window so an early/late-dated contract still shows in the first/
  // last bucket rather than vanishing from the committed total.
  const procDated = procs.map((p) => {
    const raw = +(p.needBy ?? p.startDate ?? p.endDate ?? p.createdAt);
    const ms = Math.min(Math.max(raw, windowStartMs), lastPeriodEndMs - 1);
    return { amount: Number(p.amount), ms };
  });
  const committedInPeriod = (p: Period): number =>
    procDated.reduce((s, x) => s + (x.ms >= p.startMs && x.ms < p.endMs ? x.amount : 0), 0);
  const totalCommitted = r2(procDated.reduce((s, x) => s + x.amount, 0));

  const { periods: rows, acNow, remaining } = assembleCashflow({
    periods,
    pvAt,
    acAt,
    committedInPeriod,
    nowMs,
    eacLikely: fc.eac.likely,
    windowEndMs,
  });

  return {
    hasData: true,
    granularity,
    statusDate: statusDate.toISOString(),
    window: { start: new Date(windowStartMs).toISOString(), end: new Date(windowEndMs).toISOString() },
    summary: {
      bac: fc.bac,
      acToDate: acNow,
      eacLikely: fc.eac.likely,
      remaining,
      totalCommitted,
    },
    periods: rows,
  };
}
