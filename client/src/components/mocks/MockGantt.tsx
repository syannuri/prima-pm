// On-brand SVG "capture" of the WBS/Gantt for the landing showcase (light theme, blue bars,
// milestone diamond, Today line). Scales sharply; no screenshot needed.
export default function MockGantt({ className }: { className?: string }) {
  const months = ['Jul', 'Aug', 'Sep', 'Oct'];
  const TX = 300, TW = 500;              // timeline x-start + width
  const col = TW / months.length;
  const bx = (f: number) => TX + f * TW;
  const todayX = TX + 0.52 * TW;
  // [name, depth, start(0..1), len(0..1), progress(0..1), milestone]
  const rows: [string, number, number, number, number, boolean][] = [
    ['Initiation', 0, 0.00, 0.14, 1, false],
    ['Requirements', 1, 0.10, 0.22, 1, false],
    ['Design', 1, 0.28, 0.24, 0.8, false],
    ['Build & Config', 1, 0.44, 0.34, 0.45, false],
    ['UAT & Testing', 1, 0.70, 0.20, 0, false],
    ['Go-Live', 0, 0.90, 0, 0, true],
  ];
  const rowH = 42, top = 80;
  return (
    <svg viewBox="0 0 820 360" className={className} fontFamily="ui-sans-serif, system-ui, sans-serif" role="img" aria-label="Interactive WBS and Gantt chart">
      <rect width="820" height="360" fill="#ffffff" />
      <rect width="820" height="46" fill="#f8fafc" />
      <text x="20" y="29" fill="#0f172a" fontSize="13" fontWeight="700">WBS · Gantt</text>
      {months.map((m, i) => (
        <g key={m}>
          <line x1={TX + i * col} y1="46" x2={TX + i * col} y2="360" stroke="#eef2f7" />
          <text x={TX + i * col + col / 2} y="30" textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="600">{m}</text>
        </g>
      ))}
      {/* Today marker */}
      <g className="pmx-drop">
        <line x1={todayX} y1="46" x2={todayX} y2="360" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" />
        <rect x={todayX - 17} y="49" width="34" height="13" rx="3" fill="#f59e0b" />
        <text x={todayX} y="59" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="700">TODAY</text>
      </g>
      {rows.map((r, i) => {
        const y = top + i * rowH;
        return (
          <g key={i}>
            {i % 2 === 1 && <rect x="0" y={y - 15} width="820" height={rowH} fill="#f8fafc" />}
            <rect x="16" y={y - 5} width="11" height="11" rx="2.5" fill={r[4] >= 1 ? '#22c55e' : '#ffffff'} stroke={r[4] >= 1 ? '#22c55e' : '#cbd5e1'} strokeWidth="1.5" />
            <text x={34 + r[1] * 16} y={y + 4} fill="#334155" fontSize="11.5" fontWeight={r[1] === 0 ? 700 : 500}>{r[0]}</text>
            {r[5] ? (
              <path className="pmx-pop" style={{ '--d': `${200 + i * 110}ms` } as React.CSSProperties} d={`M${bx(r[2])} ${y - 6} l8 7 l-8 7 l-8 -7 z`} fill="#2563eb" />
            ) : (
              <>
                <rect className="pmx-grow" style={{ '--d': `${200 + i * 110}ms` } as React.CSSProperties} x={bx(r[2])} y={y - 6} width={r[3] * TW} height="14" rx="4" fill="#bfdbfe" />
                <rect className="pmx-grow" style={{ '--d': `${340 + i * 110}ms` } as React.CSSProperties} x={bx(r[2])} y={y - 6} width={r[3] * TW * r[4]} height="14" rx="4" fill="#2563eb" />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
