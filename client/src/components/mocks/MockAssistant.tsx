// Dark, premium "AI Agent" hero scene (glassmorphism): a glowing gradient orb, a faint neural
// starfield, a frosted-glass insight card grounded in real data, a predictive warning, and a
// glass ask-bar with a glowing send button. On-brand, 500×320 (matches the other tour mocks'
// aspect), but deliberately dark so the AI capability reads as the flagship among the light scenes.
const STARS: [number, number, number, number][] = [
  [64, 44, 1.1, 0.5], [128, 30, 0.8, 0.35], [214, 26, 1, 0.4], [300, 40, 0.8, 0.3],
  [372, 28, 1.1, 0.45], [440, 52, 0.8, 0.3], [470, 120, 1, 0.28], [22, 120, 0.9, 0.3],
  [92, 250, 1, 0.32], [156, 292, 0.8, 0.24], [300, 300, 0.9, 0.26], [372, 286, 1, 0.3],
  [456, 232, 0.8, 0.28], [40, 300, 0.9, 0.24],
];
// Faint neural filaments near the orb (top-left), for the "intelligence" motif.
const LINKS: [number, number, number, number][] = [
  [44, 42, 92, 30], [44, 42, 128, 66], [92, 30, 128, 66], [128, 66, 214, 26],
];

export default function MockAssistant({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 320" className={className} fontFamily="ui-sans-serif, system-ui, sans-serif" role="img" aria-label="AI Agent answering a plain-language question about the project portfolio">
      <defs>
        <linearGradient id="ma-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b1120" />
          <stop offset="0.55" stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e1b4b" />
        </linearGradient>
        <radialGradient id="ma-aura" cx="0.26" cy="0.24" r="0.7">
          <stop offset="0" stopColor="#6366f1" stopOpacity="0.4" />
          <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ma-orb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="ma-send" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <filter id="ma-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="ma-halo" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>

      {/* backdrop + soft aura */}
      <rect width="500" height="320" fill="url(#ma-bg)" />
      <rect width="500" height="320" fill="url(#ma-aura)" />

      {/* neural filaments + starfield */}
      {LINKS.map(([x1, y1, x2, y2], i) => (
        <line key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#818cf8" strokeOpacity="0.18" strokeWidth="0.8" />
      ))}
      {STARS.map(([cx, cy, r, o], i) => (
        <circle key={`s${i}`} cx={cx} cy={cy} r={r} fill="#c7d2fe" opacity={o} />
      ))}

      {/* header — glowing orb + wordmark */}
      <circle cx="44" cy="42" r="24" fill="#6366f1" opacity="0.55" filter="url(#ma-halo)">
        <animate attributeName="opacity" values="0.35;0.6;0.35" dur="3.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="44" cy="42" r="15" fill="url(#ma-orb)" filter="url(#ma-glow)" />
      <path transform="translate(44 42) scale(0.72)" d="M0 -8 L1.9 -1.9 L8 0 L1.9 1.9 L0 8 L-1.9 1.9 L-8 0 L-1.9 -1.9 Z" fill="#ffffff" opacity="0.95" />
      <text x="72" y="38" fill="#e2e8f0" fontSize="16" fontWeight="800">AI Agent</text>
      <text x="72" y="54" fill="#94a3b8" fontSize="10" fontWeight="600">Reads your live project data</text>

      {/* frosted-glass insight card */}
      <rect x="28" y="82" width="444" height="150" rx="16" fill="#ffffff" fillOpacity="0.06" stroke="#ffffff" strokeOpacity="0.14" />
      <rect x="29" y="83" width="442" height="26" rx="15" fill="#ffffff" fillOpacity="0.04" />
      <text x="48" y="110" fill="#f1f5f9" fontSize="13" fontWeight="700">2 projects are over budget</text>
      <text x="452" y="110" textAnchor="end" fill="#67e8f9" fontSize="10" fontWeight="600">ranked by CPI</text>

      {/* row 1 */}
      <circle cx="52" cy="140" r="4" fill="#fb7185" filter="url(#ma-glow)" />
      <text x="66" y="144" fill="#e2e8f0" fontSize="12">Skyline Tower</text>
      <text x="452" y="144" textAnchor="end" fill="#fb7185" fontSize="12" fontWeight="700">CPI 0.86</text>
      <line x1="48" y1="156" x2="452" y2="156" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />
      {/* row 2 */}
      <circle cx="52" cy="176" r="4" fill="#fbbf24" filter="url(#ma-glow)" />
      <text x="66" y="180" fill="#e2e8f0" fontSize="12">Metro Depot</text>
      <text x="452" y="180" textAnchor="end" fill="#fbbf24" fontSize="12" fontWeight="700">CPI 0.94</text>

      {/* predictive chip (glowing) */}
      <rect x="48" y="196" width="182" height="20" rx="10" fill="#f43f5e" fillOpacity="0.15" stroke="#fb7185" strokeOpacity="0.45" />
      <circle cx="61" cy="206" r="3" fill="#fb7185" filter="url(#ma-glow)" />
      <text x="71" y="210" fill="#fda4af" fontSize="10" fontWeight="600">Predictive · schedule slip rising</text>

      {/* glass ask-bar + glowing send */}
      <rect x="28" y="248" width="444" height="42" rx="21" fill="#ffffff" fillOpacity="0.07" stroke="#ffffff" strokeOpacity="0.16" />
      <text x="52" y="273" fill="#94a3b8" fontSize="12">Ask anything about your projects</text>
      <rect x="248" y="262" width="1.6" height="14" fill="#a5b4fc">
        <animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite" />
      </rect>
      <circle cx="450" cy="269" r="15" fill="url(#ma-send)" filter="url(#ma-glow)" />
      <path d="M444 269 h10 M450 264 l5 5 -5 5" fill="none" stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />

      {/* subtle glow frame */}
      <rect x="1" y="1" width="498" height="318" rx="16" fill="none" stroke="url(#ma-orb)" strokeOpacity="0.22" strokeWidth="1" />
    </svg>
  );
}
