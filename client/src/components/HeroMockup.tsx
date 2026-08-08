// Landing hero illustration — a crisp, on-brand SVG rendering of the Prismatix light dashboard
// (charcoal rail + light content + blue accent), signed in as "Mamed". Used instead of a raw
// screenshot so the hero always matches the current theme and scales sharply on any display.
export default function HeroMockup({ className }: { className?: string }) {
  const KPI = [
    ['TOTAL BAC', 'Rp 5,68 M'],
    ['EARNED VALUE', 'Rp 4,68 M'],
    ['ACTUAL COST', 'Rp 3,69 M'],
    ['CONTINGENCY', 'Rp 67,5 jt'],
  ];
  // [name, RAG shape, colour, % complete]
  const ROWS: [string, 'circle' | 'diamond' | 'triangle', string, number][] = [
    ['SAP HANA Server Migration', 'circle', '#22c55e', 62],
    ['M365 Tenant to Tenant', 'circle', '#22c55e', 85],
    ['Core System DRC', 'diamond', '#f59e0b', 48],
  ];
  const glyph = (shape: string, color: string, cx: number, cy: number) => {
    if (shape === 'diamond') return <path d={`M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z`} fill={color} />;
    if (shape === 'triangle') return <path d={`M${cx} ${cy - 5} L${cx + 5} ${cy + 4} L${cx - 5} ${cy + 4} Z`} fill={color} />;
    return <circle cx={cx} cy={cy} r="5" fill={color} />;
  };
  return (
    <svg viewBox="0 0 820 520" className={className} role="img" fontFamily="ui-sans-serif, system-ui, sans-serif"
      aria-label="Prismatix dashboard preview — Mamed's portfolio health, EVM KPIs and project status">
      <rect width="820" height="520" fill="#f1f5f9" />

      {/* ---- charcoal sidebar rail ---- */}
      <rect width="150" height="520" fill="#1e293b" />
      <rect x="20" y="20" width="96" height="28" rx="5" fill="none" stroke="#ffffff" strokeWidth="2.5" />
      <text x="31" y="39" fill="#ffffff" fontSize="12.5" fontWeight="700" letterSpacing="1.2">PRISMATIX</text>
      <circle cx="108" cy="26" r="2.4" fill="#3b82f6" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          {i === 0 && <><rect x="16" y={70} width="118" height="26" rx="7" fill="#3b82f6" fillOpacity="0.16" /><rect x="16" y="70" width="3" height="26" rx="1.5" fill="#3b82f6" /></>}
          <circle cx="34" cy={83 + i * 34} r="5" fill={i === 0 ? '#93c5fd' : '#64748b'} />
          <rect x="46" y={79 + i * 34} width={[56, 40, 46, 62, 38][i]} height="7" rx="3.5" fill={i === 0 ? '#dbeafe' : '#475569'} />
        </g>
      ))}

      {/* ---- charcoal top bar ---- */}
      <rect x="150" width="670" height="44" fill="#1e293b" />
      <rect x="176" y="15" width="150" height="15" rx="7.5" fill="#ffffff" fillOpacity="0.08" />
      <circle cx="770" cy="22" r="7" fill="#ffffff" fillOpacity="0.1" />
      <circle cx="740" cy="22" r="7" fill="#ffffff" fillOpacity="0.1" />

      {/* ---- greeting ---- */}
      <text x="176" y="84" fill="#0f172a" fontSize="21" fontWeight="700">Good afternoon, Mamed</text>
      <text x="176" y="104" fill="#64748b" fontSize="11.5">Friday, 8 Aug 2026 · 5 projects in the portfolio</text>

      {/* ---- gauge card ---- */}
      <rect x="176" y="122" width="196" height="150" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      {/* progress-ring gauge (~78% → on-track green) on a faint track */}
      <circle cx="274" cy="204" r="46" fill="none" stroke="#e6eaf1" strokeWidth="11" />
      <circle cx="274" cy="204" r="46" fill="none" stroke="#22c55e" strokeWidth="11" strokeLinecap="round" strokeDasharray="225 289" transform="rotate(-90 274 204)" />
      <text x="274" y="198" textAnchor="middle" fill="#16a34a" fontSize="9.5" fontWeight="700">ON TRACK</text>
      <text x="274" y="222" textAnchor="middle" fill="#0f172a" fontSize="22" fontWeight="800">1.04</text>
      <text x="274" y="258" textAnchor="middle" fill="#94a3b8" fontSize="8.5" fontWeight="600">SPI · CPI 1.27</text>

      {/* ---- KPI tiles (2×2) ---- */}
      {KPI.map((k, i) => {
        const x = 388 + (i % 2) * 216, y = 122 + Math.floor(i / 2) * 74;
        return (
          <g key={i}>
            <rect x={x} y={y} width="200" height="64" rx="12" fill="#ffffff" stroke="#e2e8f0" />
            <text x={x + 16} y={y + 26} fill="#94a3b8" fontSize="9" fontWeight="600">{k[0]}</text>
            <text x={x + 16} y={y + 48} fill="#0f172a" fontSize="16" fontWeight="700">{k[1]}</text>
          </g>
        );
      })}

      {/* ---- project rows ---- */}
      <rect x="176" y="292" width="612" height="196" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="196" y="320" fill="#0f172a" fontSize="13" fontWeight="700">Portfolio health</text>
      {ROWS.map((r, i) => {
        const y = 344 + i * 44;
        return (
          <g key={i}>
            {glyph(r[1], r[2], 204, y + 6)}
            <text x="220" y={y + 10} fill="#334155" fontSize="12" fontWeight="500">{r[0]}</text>
            <rect x="480" y={y + 1} width="230" height="9" rx="4.5" fill="#eef2f7" />
            <rect x="480" y={y + 1} width={230 * (r[3] / 100)} height="9" rx="4.5" fill="#2563eb" />
            <text x="726" y={y + 10} fill="#475569" fontSize="11" fontWeight="700">{r[3]}%</text>
          </g>
        );
      })}
    </svg>
  );
}
