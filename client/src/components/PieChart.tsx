// Dependency-free SVG donut chart with a legend.
export interface Slice { label: string; value: number; color: string }

export default function PieChart({ title, data }: { title: string; data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const slices = data.filter((d) => d.value > 0);

  let acc = 0; // accumulated percentage, for dash offsets
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{title}</div>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No data</p>
      ) : (
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 42 42" className="h-28 w-28 shrink-0">
            <circle cx="21" cy="21" r="15.915" fill="none" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="5" />
            {slices.map((s) => {
              const pct = (s.value / total) * 100;
              const el = (
                <circle
                  key={s.label}
                  cx="21" cy="21" r="15.915" fill="none"
                  stroke={s.color} strokeWidth="5"
                  strokeDasharray={`${pct} ${100 - pct}`}
                  strokeDashoffset={25 - acc}
                />
              );
              acc += pct;
              return el;
            })}
            <text x="21" y="21" textAnchor="middle" dominantBaseline="central" className="fill-slate-700 dark:fill-slate-200" style={{ fontSize: 6, fontWeight: 700 }}>
              {total}
            </text>
          </svg>
          <ul className="flex-1 space-y-1 text-sm">
            {data.map((d) => (
              <li key={d.label} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
                <span className="flex-1 text-slate-600 dark:text-slate-300">{d.label}</span>
                <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{d.value}</span>
                <span className="w-10 text-right tabular-nums text-xs text-slate-400 dark:text-slate-500">
                  {total ? `${Math.round((d.value / total) * 100)}%` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
