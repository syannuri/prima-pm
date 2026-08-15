// On-brand SVG "capture" of the EVM S-curve (PV · EV · AC) with SPI/CPI chips, for the landing
// showcase. Light theme; curves are a smooth logistic S so it reads as cumulative value.
import { useId } from 'react';
export default function MockSCurve({ className }: { className?: string }) {
  const wipeId = useId();               // unique clip id (mock renders twice: hero tour + showcase)
  const X0 = 46, Y0 = 250, W = 410, H = 196;
  const px = (t: number) => X0 + t * W;
  const py = (v: number) => Y0 - v * H;
  const s = (t: number) => 1 / (1 + Math.exp(-9 * (t - 0.5)));      // logistic 0..1
  const pts = (k: number, tMax: number) =>
    Array.from({ length: Math.round(tMax * 20) + 1 }, (_, i) => {
      const t = i / 20;
      return `${px(t).toFixed(1)},${py(s(t) * k).toFixed(1)}`;
    }).join(' ');
  const area = (k: number, tMax: number) => `${pts(k, tMax)} ${px(tMax).toFixed(1)},${Y0} ${px(0).toFixed(1)},${Y0}`;
  const endDot = (k: number, tMax: number) => ({ cx: px(tMax), cy: py(s(tMax) * k) });
  const evEnd = endDot(0.82, 0.62), acEnd = endDot(0.9, 0.62);
  return (
    <svg viewBox="0 0 500 320" className={className} fontFamily="ui-sans-serif, system-ui, sans-serif" role="img" aria-label="Earned-value S-curve with SPI and CPI">
      <defs>
        <linearGradient id="mockEvGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
        {/* playhead wipe: the whole plot area is revealed left-to-right when the scene plays */}
        <clipPath id={wipeId}><rect className="pmx-wipe" x={X0 - 2} y="48" width={W + 12} height={Y0 - 44} /></clipPath>
      </defs>
      <rect width="500" height="320" fill="#ffffff" />
      <text x="24" y="34" fill="#0f172a" fontSize="13" fontWeight="700">EVM S-Curve</text>
      {/* SPI / CPI chips */}
      <rect x="330" y="20" width="70" height="20" rx="10" fill="#dcfce7" />
      <text x="365" y="34" textAnchor="middle" fill="#15803d" fontSize="10" fontWeight="700">SPI 1.04</text>
      <rect x="406" y="20" width="70" height="20" rx="10" fill="#dcfce7" />
      <text x="441" y="34" textAnchor="middle" fill="#15803d" fontSize="10" fontWeight="700">CPI 1.27</text>
      {/* gridlines + axes */}
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={X0} y1={py(g)} x2={X0 + W} y2={py(g)} stroke="#eef2f7" />
      ))}
      <line x1={X0} y1={Y0} x2={X0 + W} y2={Y0} stroke="#cbd5e1" />
      {/* today divider */}
      <line x1={px(0.62)} y1="54" x2={px(0.62)} y2={Y0} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3" />
      <g clipPath={`url(#${wipeId})`}>
        {/* soft area under the earned-value curve */}
        <polygon points={area(0.82, 0.62)} fill="url(#mockEvGrad)" stroke="none" />
        {/* PV (planned, slate) full span */}
        <polyline points={pts(1, 1)} fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
        {/* AC (actual cost, rose) to today */}
        <polyline points={pts(0.9, 0.62)} fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* EV (earned value, blue) to today */}
        <polyline points={pts(0.82, 0.62)} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {/* current-value dots at "today" */}
        <circle cx={acEnd.cx} cy={acEnd.cy} r="3.6" fill="#f43f5e" stroke="#fff" strokeWidth="1.4" />
        <circle cx={evEnd.cx} cy={evEnd.cy} r="4" fill="#2563eb" stroke="#fff" strokeWidth="1.4" />
      </g>
      {/* legend */}
      {[['#2563eb', 'EV', 24], ['#f43f5e', 'AC', 92], ['#94a3b8', 'PV', 160]].map(([c, l, x]) => (
        <g key={l as string}>
          <rect x={x as number} y="284" width="16" height="4" rx="2" fill={c as string} />
          <text x={(x as number) + 22} y="290" fill="#64748b" fontSize="11">{l as string}</text>
        </g>
      ))}
    </svg>
  );
}
