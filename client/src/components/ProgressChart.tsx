// Dependency-free vertical bar chart: % schedule progress per project.
export interface ProgressDatum {
  name: string;
  progress: number; // 0..1
}

const GRID = [100, 75, 50, 25, 0];

export default function ProgressChart({ title, data }: { title: string; data: ProgressDatum[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">{title}</div>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No data</p>
      ) : (
        <div className="flex gap-2">
          {/* Y axis */}
          <div className="flex h-28 flex-col justify-between text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
            {GRID.map((g) => <span key={g} className="leading-none">{g}%</span>)}
          </div>

          <div className="min-w-0 flex-1">
            {/* Plot: gridlines + bars */}
            <div className="relative h-28">
              {GRID.map((g) => (
                <div key={g} className="absolute inset-x-0 border-t border-slate-100 dark:border-slate-800/80" style={{ top: `${100 - g}%` }} />
              ))}
              <div className="relative flex h-full items-end gap-2">
                {data.map((d, i) => {
                  const pct = Math.round(Math.min(1, Math.max(0, d.progress)) * 100);
                  return (
                    <div key={i} className="flex h-full flex-1 items-end justify-center" title={`${d.name}: ${pct}%`}>
                      <div
                        className="w-full max-w-[2rem] rounded-t bg-brand-500 transition-[height] duration-500"
                        style={{ height: `${Math.max(pct, 1.5)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Labels: name + % */}
            <div className="mt-1.5 flex gap-2">
              {data.map((d, i) => {
                const pct = Math.round(Math.min(1, Math.max(0, d.progress)) * 100);
                return (
                  <div key={i} className="min-w-0 flex-1 text-center" title={d.name}>
                    <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">{d.name}</div>
                    <div className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
