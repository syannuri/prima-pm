import { useId, useState } from 'react';

// Elegant donut with soft depth: per-slice arcs, a unified top sheen (gloss),
// a soft drop shadow, and on hover the slice pops out + brightens and a tooltip
// lists the projects in that slice.
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  items: string[]; // project names in this slice (shown on hover)
}

const CX = 60, CY = 60, R = 47, IR = 29; // donut geometry

function pt(radius: number, angle: number): [number, number] {
  const t = ((angle - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(t), CY + radius * Math.sin(t)];
}

function donutPath(a0: number, a1: number): string {
  if (a1 - a0 >= 360) a1 = a0 + 359.999; // full ring → tiny invisible seam
  const [ox0, oy0] = pt(R, a0);
  const [ox1, oy1] = pt(R, a1);
  const [ix1, iy1] = pt(IR, a1);
  const [ix0, iy0] = pt(IR, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${ox0} ${oy0} A${R} ${R} 0 ${large} 1 ${ox1} ${oy1} L${ix1} ${iy1} A${IR} ${IR} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

export default function DonutChart({ title, slices }: { title: string; slices: DonutSlice[] }) {
  const uid = useId().replace(/:/g, '');
  const total = slices.reduce((s, d) => s + d.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Precompute angles for non-empty slices.
  let acc = 0;
  const segs = slices.map((s) => {
    const frac = total ? s.value / total : 0;
    const a0 = acc * 360;
    acc += frac;
    const a1 = acc * 360;
    return { ...s, a0, a1, frac };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{title}</div>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No data</p>
      ) : (
        <div className="relative flex items-center gap-4" onMouseLeave={() => setHover(null)}>
          <svg
            viewBox="0 0 120 120"
            className="h-32 w-32 shrink-0 overflow-visible"
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
            }}
          >
            <defs>
              <filter id={`sh${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#0f172a" floodOpacity="0.28" />
              </filter>
              {/* top→bottom white sheen for a soft glassy 3D feel */}
              <linearGradient id={`gloss${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.38" />
                <stop offset="45%" stopColor="#fff" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>

            <g filter={`url(#sh${uid})`}>
              {segs.map((s, i) =>
                s.value > 0 ? (
                  (() => {
                    const mid = ((s.a0 + s.a1) / 2 - 90) * (Math.PI / 180);
                    const off = hover === i ? 4 : 0;
                    return (
                      <path
                        key={i}
                        d={donutPath(s.a0, s.a1)}
                        fill={s.color}
                        stroke="#fff"
                        strokeWidth={1.5}
                        className="cursor-pointer transition-transform duration-150"
                        style={{
                          transform: `translate(${Math.cos(mid) * off}px, ${Math.sin(mid) * off}px)`,
                          filter: hover === i ? 'brightness(1.12)' : undefined,
                        }}
                        onMouseEnter={() => setHover(i)}
                      />
                    );
                  })()
                ) : null,
              )}
            </g>
            {/* sheen overlay on the ring */}
            <path d={donutPath(0, 360)} fill={`url(#gloss${uid})`} pointerEvents="none" />
            <text x={CX} y={CY} textAnchor="middle" dominantBaseline="central" className="fill-slate-700 dark:fill-slate-200" style={{ fontSize: 15, fontWeight: 700 }}>
              {total}
            </text>
          </svg>

          {/* Legend */}
          <ul className="flex-1 space-y-1 text-sm">
            {slices.map((d, i) => (
              <li
                key={d.label}
                className={`flex items-center gap-2 rounded px-1 py-0.5 transition-colors ${hover === i ? 'bg-slate-50 dark:bg-slate-800' : ''}`}
                onMouseEnter={() => d.value > 0 && setHover(i)}
              >
                <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
                <span className="flex-1 text-slate-600 dark:text-slate-300">{d.label}</span>
                <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{d.value}</span>
                <span className="w-10 text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">{total ? Math.round((d.value / total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>

          {/* Hover tooltip — which projects are in this slice */}
          {hover !== null && segs[hover]?.value > 0 && (
            <div
              className="pointer-events-none absolute z-20 w-52 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-800"
              style={{ left: Math.min(pos.x + 14, 150), top: pos.y + 10 }}
            >
              <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: segs[hover].color }} />
                {segs[hover].label} · {Math.round(segs[hover].frac * 100)}%
              </div>
              <ul className="space-y-0.5 text-slate-600 dark:text-slate-300">
                {segs[hover].items.map((n) => (
                  <li key={n} className="truncate">• {n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
