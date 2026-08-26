// Pure time-phasing helpers for the cash-flow / time-phased budget view.
// No DB, no I/O — kept separate from cashflow.service so the bucketing maths is unit-testable.
//
// A "cash-flow" breaks the project spend into calendar periods (week / month / quarter) and, for
// each period, reports the PLANNED outflow (BCWS increment), ACTUAL outflow (AC increment, capped
// at the status date), FORECAST cash need (remaining EAC spread over the future planned shape) and
// COMMITTED cost (POs bucketed by their need date). Cumulative planned/actual/forecast form the
// classic S-curve overlay.

export type Granularity = 'week' | 'month' | 'quarter';

export interface Period {
  key: string; // stable id, e.g. "2026-03" / "2026-Q2" / "2026-W12"
  label: string; // human label, e.g. "Mar 2026"
  startMs: number; // inclusive period start (UTC ms)
  endMs: number; // EXCLUSIVE period end (UTC ms) — the start of the next period
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- Period-start alignment (all UTC to avoid TZ drift) ---
function startOfPeriod(ms: number, gran: Granularity): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (gran === 'month') return Date.UTC(y, d.getUTCMonth(), 1);
  if (gran === 'quarter') return Date.UTC(y, Math.floor(d.getUTCMonth() / 3) * 3, 1);
  // week — align to Monday 00:00 UTC
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (day + 6) % 7;
  return Date.UTC(y, d.getUTCMonth(), d.getUTCDate() - backToMonday);
}

function nextPeriodStart(startMs: number, gran: Granularity): number {
  const d = new Date(startMs);
  const y = d.getUTCFullYear();
  if (gran === 'month') return Date.UTC(y, d.getUTCMonth() + 1, 1);
  if (gran === 'quarter') return Date.UTC(y, d.getUTCMonth() + 3, 1);
  return startMs + 7 * 24 * 60 * 60 * 1000; // week
}

function isoWeek(ms: number): number {
  // ISO 8601 week number of the Monday-aligned week start.
  const d = new Date(ms);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // nearest Thursday
  const firstThursday = Date.UTC(target.getUTCFullYear(), 0, 4);
  const ft = new Date(firstThursday);
  ft.setUTCDate(ft.getUTCDate() - ((ft.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((+target - +ft) / (7 * 24 * 60 * 60 * 1000));
}

function labelFor(startMs: number, gran: Granularity): { key: string; label: string } {
  const d = new Date(startMs);
  const y = d.getUTCFullYear();
  if (gran === 'month') {
    return { key: `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getUTCMonth()]} ${y}` };
  }
  if (gran === 'quarter') {
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
  }
  const w = isoWeek(startMs);
  return { key: `${y}-W${String(w).padStart(2, '0')}`, label: `W${w} ${MONTHS[d.getUTCMonth()]}` };
}

// Enumerate the calendar-aligned periods spanning [startMs, endMs]. Always returns at least one
// period. The final period's endMs is the natural period boundary (may extend past endMs) so
// cumulative sampling lands on clean calendar edges.
export function enumeratePeriods(startMs: number, endMs: number, gran: Granularity): Period[] {
  const periods: Period[] = [];
  let cur = startOfPeriod(startMs, gran);
  const guard = 2000; // hard cap (~38y weekly) against a runaway window
  while (cur <= endMs && periods.length < guard) {
    const next = nextPeriodStart(cur, gran);
    const { key, label } = labelFor(cur, gran);
    periods.push({ key, label, startMs: cur, endMs: next });
    cur = next;
  }
  return periods;
}

export interface CashflowPeriod {
  key: string;
  label: string;
  start: string; // ISO
  planned: number; // BCWS increment this period
  actual: number | null; // AC increment (null once fully in the future)
  forecast: number | null; // projected cash need this period (null for fully-past periods)
  committed: number; // Σ PO amounts bucketed into this period
  cumPlanned: number;
  cumActual: number | null;
  cumForecast: number | null; // forecast S-curve: rises from AC@now up to EAC
}

export interface AssembleInput {
  periods: Period[];
  pvAt: (ms: number) => number; // cumulative planned value as of a date
  acAt: (ms: number) => number; // cumulative actual cost as of a date
  committedInPeriod: (p: Period) => number; // Σ PO amounts whose need-date lands in [start,end)
  nowMs: number;
  eacLikely: number; // likely estimate at completion (cumulative forecast target)
  windowEndMs: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Assemble the per-period cash-flow rows. Pure — all DB access is injected via pvAt/acAt/committed.
export function assembleCashflow(input: AssembleInput): { periods: CashflowPeriod[]; acNow: number; remaining: number } {
  const { periods, pvAt, acAt, committedInPeriod, nowMs, eacLikely, windowEndMs } = input;
  const acNow = acAt(nowMs);
  const remaining = Math.max(eacLikely - acNow, 0);
  // Total planned value still to be earned after the status date — drives how we spread the
  // remaining EAC across future periods (follow the planned shape, not a flat line).
  const remainingPlannedPv = Math.max(pvAt(windowEndMs) - pvAt(nowMs), 0);
  const futurePeriods = periods.filter((p) => p.endMs > nowMs);

  let cumForecast = acNow;
  const rows: CashflowPeriod[] = periods.map((p) => {
    // Planned: full BCWS increment across the period boundaries.
    const planned = r2(pvAt(p.endMs) - pvAt(p.startMs));

    // Actual: real spend, capped at the status date. Fully-future periods → null (not zero) so the
    // chart/table can distinguish "no spend yet" from "future".
    const acEnd = acAt(Math.min(p.endMs, nowMs));
    const acStart = acAt(Math.min(p.startMs, nowMs));
    const actual = p.startMs >= nowMs ? null : r2(acEnd - acStart);

    // Forecast: only for the still-to-come portion. Weight by that period's share of the remaining
    // planned PV (the post-now slice of a straddling period counts); fall back to an even split when
    // there's no planned PV left to shape it.
    let forecast: number | null = null;
    if (p.endMs > nowMs) {
      const futurePlanned = pvAt(p.endMs) - pvAt(Math.max(p.startMs, nowMs));
      const share = remainingPlannedPv > 0 ? futurePlanned / remainingPlannedPv : 1 / Math.max(futurePeriods.length, 1);
      forecast = r2(remaining * share);
    }

    const committed = r2(committedInPeriod(p));

    const cumPlanned = r2(pvAt(p.endMs));
    const cumActual = p.startMs >= nowMs ? null : r2(acAt(Math.min(p.endMs, nowMs)));
    if (forecast != null) cumForecast += forecast;
    const cumForecastOut = p.endMs > nowMs ? r2(cumForecast) : null;

    return {
      key: p.key,
      label: p.label,
      start: new Date(p.startMs).toISOString(),
      planned,
      actual,
      forecast,
      committed,
      cumPlanned,
      cumActual,
      cumForecast: cumForecastOut,
    };
  });

  return { periods: rows, acNow: r2(acNow), remaining: r2(remaining) };
}
