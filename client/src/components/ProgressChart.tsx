// Grouped vertical bar chart: planned (baseline) vs actual % progress per project.
export interface ProgressDatum {
  name: string;
  actual: number; // 0..1 — physical % complete (WBS roll-up)
  baseline: number; // 0..1 — planned % at the status date (PV ÷ BAC)
}

const GRID = [100, 75, 50, 25, 0];
const BASE_COLOR = '#94a3b8'; // slate-400 — planned baseline
const ACTUAL_COLOR = '#f4675f'; // brand-500 — actual

const clampPct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);

export default function ProgressChart({ title, data }: { title: string; data: ProgressDatum[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BASE_COLOR }} />Baseline</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: ACTUAL_COLOR }} />Actual</span>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No data</p>
      ) : (
        <div className="flex gap-2">
          {/* Y axis */}
          <div className="flex h-28 flex-col justify-between text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
            {GRID.map((g) => <span key={g} className="leading-none">{g}%</span>)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative h-28">
              {GRID.map((g) => (
                <div key={g} className="absolute inset-x-0 border-t border-slate-100 dark:border-slate-800/80" style={{ top: `${100 - g}%` }} />
              ))}
              <div className="relative flex h-full items-end gap-2">
                {data.map((d, i) => {
                  const a = clampPct(d.actual);
                  const bl = clampPct(d.baseline);
                  return (
                    <div
                      key={i}
                      className="flex h-full flex-1 items-end justify-center gap-1"
                      title={`${d.name} — Baseline ${bl}% · Actual ${a}%`}
                    >
                      <div className="w-full max-w-[0.9rem] rounded-t bg-slate-400 transition-[height] duration-500 dark:bg-slate-500" style={{ height: `${Math.max(bl, 1.5)}%` }} />
                      <div className="w-full max-w-[0.9rem] rounded-t bg-brand-500 transition-[height] duration-500" style={{ height: `${Math.max(a, 1.5)}%` }} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Labels: name + baseline/actual % */}
            <div className="mt-1.5 flex gap-2">
              {data.map((d, i) => (
                <div key={i} className="min-w-0 flex-1 text-center" title={d.name}>
                  <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">{d.name}</div>
                  <div className="text-[11px] font-semibold tabular-nums">
                    <span className="text-slate-400 dark:text-slate-500">{clampPct(d.baseline)}%</span>
                    <span className="text-slate-300 dark:text-slate-600"> · </span>
                    <span className="text-brand-600 dark:text-brand-400">{clampPct(d.actual)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
