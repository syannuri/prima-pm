// Pure, time-phased resource-capacity math. No DB/IO here so it stays unit-testable.
//
// Model: a person can deliver at most 1 man-day of work per business day (Mon–Fri).
// Each manpower line spreads its planned man-days evenly across the business days of
// its linked task interval. Summed per resource per calendar period, an allocation
// that exceeds the available business days in that period means over-allocation.

export type Granularity = 'week' | 'month';

export interface AllocationInput {
  resourceKey: string; // stable identity (named user, else project+label)
  resourceName: string; // display label
  personnelRole: string | null;
  capacityPerDay?: number; // mandays this resource can deliver per business day (default 1)
  projectId: string;
  projectCode: string;
  projectName: string;
  planMandays: number;
  taskStart: Date | null;
  taskEnd: Date | null;
  progressPct?: number; // 0..100 of the linked task; drives earned man-days (default 0)
}

export interface PeriodCell {
  period: string;
  allocated: number;
  capacity: number;
  utilization: number; // allocated / capacity (0 when no capacity)
  over: boolean; // allocated > capacity (+ small epsilon)
}

export interface ResourceRow {
  key: string;
  name: string;
  personnelRole: string | null;
  totalPlanMandays: number;
  earnedMandays: number; // Σ(planMandays × task %progress) — effort delivered so far
  scheduledMandays: number; // man-days that fell inside the reporting window
  unscheduledMandays: number; // items with no task dates → cannot be time-phased
  projects: { code: string; name: string; mandays: number }[];
  cells: PeriodCell[];
  peakUtilization: number;
  overAllocated: boolean;
}

export interface CapacityReport {
  from: string | null;
  to: string | null;
  granularity: Granularity;
  periods: string[];
  resources: ResourceRow[];
  summary: { resourceCount: number; overAllocatedCount: number; totalPlanMandays: number; totalEarnedMandays: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-6;
const round2 = (n: number) => Math.round((n + EPSILON) * 100) / 100;

// Normalize any Date to UTC midnight so calendar math ignores time-of-day & TZ.
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  return dow >= 1 && dow <= 5;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Inclusive list of business days between two dates (order-tolerant). */
export function eachBusinessDay(start: Date, end: Date): Date[] {
  let cur = utcDay(start);
  const last = utcDay(end);
  if (cur > last) return [];
  const out: Date[] = [];
  while (cur <= last) {
    if (isBusinessDay(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function businessDaysBetween(start: Date, end: Date): number {
  return eachBusinessDay(start, end).length;
}

// Monday (UTC) of the week containing d.
function mondayOf(d: Date): Date {
  const day = utcDay(d);
  const dow = day.getUTCDay(); // 0..6, Sun=0
  const delta = dow === 0 ? -6 : 1 - dow; // shift back to Monday
  return addDays(day, delta);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Stable, lexically-sortable period key for a date. Week → its Monday's YYYY-MM-DD. */
export function periodKey(d: Date, g: Granularity): string {
  const day = utcDay(d);
  if (g === 'month') return `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}`;
  const mon = mondayOf(day);
  return `${mon.getUTCFullYear()}-${pad2(mon.getUTCMonth() + 1)}-${pad2(mon.getUTCDate())}`;
}

/** Ordered list of period keys spanning [from, to] inclusive. */
export function periodsInRange(from: Date, to: Date, g: Granularity): string[] {
  const out: string[] = [];
  const last = utcDay(to);
  let cur = g === 'month'
    ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
    : mondayOf(from);
  while (cur <= last) {
    out.push(periodKey(cur, g));
    cur = g === 'month'
      ? new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
      : addDays(cur, 7);
  }
  return out;
}

/**
 * Build the time-phased capacity report.
 * @param windowFrom/windowTo optional clamp; default = span of all dated tasks.
 */
export function buildCapacityReport(
  items: AllocationInput[],
  granularity: Granularity,
  windowFrom?: Date | null,
  windowTo?: Date | null,
): CapacityReport {
  const dated = items.filter((i) => i.taskStart && i.taskEnd && i.planMandays > 0);

  // Derive the reporting window from data if not supplied.
  let from = windowFrom ? utcDay(windowFrom) : null;
  let to = windowTo ? utcDay(windowTo) : null;
  if (!from || !to) {
    for (const i of dated) {
      const s = utcDay(i.taskStart!);
      const e = utcDay(i.taskEnd!);
      if (!from || s < from) from = windowFrom ? from : s;
      if (!to || e > to) to = windowTo ? to : e;
    }
  }

  const periods = from && to && from <= to ? periodsInRange(from, to, granularity) : [];
  const periodSet = new Set(periods);

  // Business days per period inside the window. A resource's capacity in a period
  // is businessDays × its capacityPerDay (1 = full-time, 2 = a crew of two, …).
  const bizDays = new Map<string, number>();
  if (from && to) {
    for (const d of eachBusinessDay(from, to)) {
      const k = periodKey(d, granularity);
      bizDays.set(k, (bizDays.get(k) ?? 0) + 1);
    }
  }

  interface Acc {
    name: string;
    personnelRole: string | null;
    capacityPerDay: number;
    total: number;
    earned: number;
    scheduled: number;
    unscheduled: number;
    projects: Map<string, { code: string; name: string; mandays: number }>;
    alloc: Map<string, number>;
  }
  const byResource = new Map<string, Acc>();
  const ensure = (i: AllocationInput): Acc => {
    let a = byResource.get(i.resourceKey);
    if (!a) {
      a = { name: i.resourceName, personnelRole: i.personnelRole, capacityPerDay: i.capacityPerDay && i.capacityPerDay > 0 ? i.capacityPerDay : 1, total: 0, earned: 0, scheduled: 0, unscheduled: 0, projects: new Map(), alloc: new Map() };
      byResource.set(i.resourceKey, a);
    }
    return a;
  };
  const addProject = (a: Acc, i: AllocationInput, mandays: number) => {
    const p = a.projects.get(i.projectId);
    if (p) p.mandays = round2(p.mandays + mandays);
    else a.projects.set(i.projectId, { code: i.projectCode, name: i.projectName, mandays: round2(mandays) });
  };

  for (const i of items) {
    const a = ensure(i);
    a.total = round2(a.total + i.planMandays);
    // Earned man-days = plan × task progress (clamped 0..100), independent of dates.
    const pct = Math.min(100, Math.max(0, i.progressPct ?? 0));
    a.earned = round2(a.earned + (i.planMandays * pct) / 100);
    addProject(a, i, i.planMandays);

    if (!(i.taskStart && i.taskEnd && i.planMandays > 0)) {
      a.unscheduled = round2(a.unscheduled + i.planMandays);
      continue;
    }
    const days = eachBusinessDay(i.taskStart, i.taskEnd);
    if (days.length === 0) {
      a.unscheduled = round2(a.unscheduled + i.planMandays);
      continue;
    }
    const rate = i.planMandays / days.length; // man-days per business day
    for (const d of days) {
      const k = periodKey(d, granularity);
      if (!periodSet.has(k)) continue; // outside reporting window
      a.alloc.set(k, (a.alloc.get(k) ?? 0) + rate);
      a.scheduled = a.scheduled + rate;
    }
  }

  const resources: ResourceRow[] = [];
  for (const [key, a] of byResource) {
    const cells: PeriodCell[] = periods.map((p) => {
      const allocated = round2(a.alloc.get(p) ?? 0);
      const cap = round2((bizDays.get(p) ?? 0) * a.capacityPerDay);
      const utilization = cap > 0 ? round2(allocated / cap) : 0;
      return { period: p, allocated, capacity: cap, utilization, over: allocated > cap + EPSILON };
    });
    const peakUtilization = cells.reduce((m, c) => Math.max(m, c.utilization), 0);
    resources.push({
      key,
      name: a.name,
      personnelRole: a.personnelRole,
      totalPlanMandays: round2(a.total),
      earnedMandays: round2(a.earned),
      scheduledMandays: round2(a.scheduled),
      unscheduledMandays: round2(a.unscheduled),
      projects: [...a.projects.values()].sort((x, y) => y.mandays - x.mandays),
      cells,
      peakUtilization,
      overAllocated: cells.some((c) => c.over),
    });
  }
  // Busiest (and over-allocated) resources first.
  resources.sort((x, y) => Number(y.overAllocated) - Number(x.overAllocated) || y.peakUtilization - x.peakUtilization || y.totalPlanMandays - x.totalPlanMandays);

  return {
    from: from ? periodKeyDate(from) : null,
    to: to ? periodKeyDate(to) : null,
    granularity,
    periods,
    resources,
    summary: {
      resourceCount: resources.length,
      overAllocatedCount: resources.filter((r) => r.overAllocated).length,
      totalPlanMandays: round2(resources.reduce((s, r) => s + r.totalPlanMandays, 0)),
      totalEarnedMandays: round2(resources.reduce((s, r) => s + r.earnedMandays, 0)),
    },
  };
}

function periodKeyDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// --- Resource master: effective day-rate resolution ---
// An explicit override (> 0) wins; otherwise inherit the linked rate card's rate.
export function effectiveDayRate(
  override: number | null | undefined,
  rateCardRate: number | null | undefined,
): number {
  if (override != null && override > 0) return override;
  return rateCardRate ?? 0;
}
