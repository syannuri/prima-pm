import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { getEvm } from '../schedule/schedule.service.js';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

// Project-level EVM forecast: EAC scenarios, schedule/date forecast, projected
// margin and an S-curve (planned PV, actual AC to date, forecast cost to EAC).
export async function getProjectForecast(projectId: string, statusDate: Date) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { totalRevenueIdr: true },
  });
  if (!project) throw NotFound('Project not found');

  const [evm, charter, tasks, actuals] = await Promise.all([
    getEvm(projectId, undefined, statusDate),
    prisma.projectCharter.findUnique({ where: { projectId }, select: { hiScheduleStart: true, hiScheduleEnd: true } }),
    prisma.task.findMany({ where: { projectId }, select: { planStart: true, planEnd: true } }),
    prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' }, select: { date: true, amount: true } }),
  ]);

  const { bac, ev, ac, cpi, spi } = evm;

  // --- EAC scenarios (best / likely / worst) ---
  // Optimistic: remaining work goes to plan.  Likely: current cost trend continues
  // (BAC/CPI).  Pessimistic: both cost AND schedule drag continue.
  const optimistic = r2(ac + (bac - ev));
  const likely = cpi > 0 ? r2(bac / cpi) : bac;
  const scpi = cpi * spi;
  const pessimistic = scpi > 0 ? r2(ac + (bac - ev) / scpi) : likely;

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
    // PV is schedule-only; pass actualCost=0 to skip the (irrelevant) AC lookup per sample.
    const pvs = await Promise.all(dates.map((d) => getEvm(projectId, 0, new Date(d)).then((e) => e.pv)));
    dates.forEach((d, i) => {
      const forecast = forecastFinish && forecastFinish > now && d >= now
        ? r2(ac + (likely - ac) * ((d - now) / (forecastFinish - now)))
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
    margin: { revenue, planned: r2(revenue - bac), projected: r2(revenue - likely) },
    hasData,
    sCurve,
  };
}
