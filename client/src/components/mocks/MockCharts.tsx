// On-brand SVG "capture" of the portfolio status charts (RAG donuts) for the landing showcase.
// Donut segments use stroke-dasharray rings (crisp in-browser); colours from the RAG language.
const R = 50, SW = 17, C = 2 * Math.PI * R;

function Donut({ cx, cy, title, segs }: { cx: number; cy: number; title: string; segs: [number, string][] }) {
  const total = segs.reduce((s, [n]) => s + n, 0);
  let acc = 0;
  return (
    <g>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#eef2f7" strokeWidth={SW} />
      {segs.map(([n, color], i) => {
        const seg = (n / total) * C;
        const start = (acc / total) * C;
        acc += n;
        return (
          <circle key={i} cx={cx} cy={cy} r={R} fill="none" stroke={color} strokeWidth={SW}
            strokeDasharray={`${seg.toFixed(1)} ${(C - seg).toFixed(1)}`} strokeDashoffset={(-start).toFixed(1)}
            transform={`rotate(-90 ${cx} ${cy})`} />
        );
      })}
      <text x={cx} y={cy + 2} textAnchor="middle" fill="#0f172a" fontSize="24" fontWeight="800">{total}</text>
      <text x={cx} y={cy + 18} textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="600">PROJECTS</text>
      <text x={cx} y={cy + R + 34} textAnchor="middle" fill="#334155" fontSize="12" fontWeight="600">{title}</text>
    </g>
  );
}

export default function MockCharts({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 320" className={className} fontFamily="ui-sans-serif, system-ui, sans-serif" role="img" aria-label="Portfolio cost and schedule status charts">
      <rect width="500" height="320" fill="#ffffff" />
      <text x="24" y="34" fill="#0f172a" fontSize="13" fontWeight="700">Portfolio status</text>
      <Donut cx={140} cy={150} title="Cost (CPI)" segs={[[4, '#22c55e'], [1, '#f59e0b']]} />
      <Donut cx={360} cy={150} title="Schedule (SPI)" segs={[[3, '#22c55e'], [1, '#f59e0b'], [1, '#ef4444']]} />
      {/* legend */}
      {[['#22c55e', 'On track'], ['#f59e0b', 'At risk'], ['#ef4444', 'Behind']].map(([c, l], i) => (
        <g key={l}>
          <circle cx={150 + i * 118} cy="296" r="5" fill={c} />
          <text x={160 + i * 118} y="300" fill="#64748b" fontSize="11">{l}</text>
        </g>
      ))}
    </svg>
  );
}
