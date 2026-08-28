// On-brand SVG "capture" of the AI Agent at work for the landing hero tour: a plain-language
// question, a data-grounded answer with a mini table, a predictive warning, and a human-approved
// action proposal — the AI capability, shown in one glance. Matches the other mocks (500×320,
// light theme, RAG colours). The assistant is branded "AI Agent" (the internal name is not used).
export default function MockAssistant({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 320" className={className} fontFamily="ui-sans-serif, system-ui, sans-serif" role="img" aria-label="AI Agent answering a plain-language question about the project">
      <defs>
        <linearGradient id="ma-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="500" height="320" fill="#ffffff" />

      {/* header — AI Agent wordmark + sparkle */}
      <g transform="translate(24 20)">
        <path className="pmx-sweep" style={{ ['--pmx-len' as string]: 40 }} d="M8 0 L9.6 6.4 L16 8 L9.6 9.6 L8 16 L6.4 9.6 L0 8 L6.4 6.4 Z" fill="url(#ma-brand)" />
        <text x="24" y="8" fill="#0f172a" fontSize="15" fontWeight="800">AI Agent</text>
        <text x="24" y="22" fill="#94a3b8" fontSize="10" fontWeight="600">Reads your live project data</text>
      </g>

      {/* user question bubble (right) */}
      <g>
        <rect x="196" y="52" width="280" height="34" rx="11" fill="url(#ma-brand)" />
        <text x="336" y="74" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="600">Which projects are over budget?</text>
      </g>

      {/* AI answer bubble (left) */}
      <rect x="24" y="100" width="452" height="150" rx="14" fill="#ffffff" stroke="#c7d2fe" strokeWidth="1.5" />
      <circle cx="44" cy="122" r="9" fill="url(#ma-brand)" />
      <path d="M44 116 L44.8 120.5 L49 121.4 L44.8 122.3 L44 127 L43.2 122.3 L39 121.4 L43.2 120.5 Z" fill="#ffffff" />
      <text x="60" y="126" fill="#6366f1" fontSize="10" fontWeight="700">AI Agent</text>
      <text x="44" y="152" fill="#334155" fontSize="12" fontWeight="600">2 projects are over budget — worth a look:</text>

      {/* mini data table */}
      <line x1="44" y1="164" x2="456" y2="164" stroke="#eef2f7" strokeWidth="1" />
      <circle cx="50" cy="182" r="4" fill="#ef4444" />
      <text x="62" y="186" fill="#0f172a" fontSize="12">Skyline Tower</text>
      <text x="452" y="186" textAnchor="end" fill="#dc2626" fontSize="12" fontWeight="700">CPI 0.86</text>
      <line x1="44" y1="196" x2="456" y2="196" stroke="#eef2f7" strokeWidth="1" />
      <circle cx="50" cy="214" r="4" fill="#f59e0b" />
      <text x="62" y="218" fill="#0f172a" fontSize="12">Metro Depot</text>
      <text x="452" y="218" textAnchor="end" fill="#d97706" fontSize="12" fontWeight="700">CPI 0.94</text>

      {/* predictive warning chip */}
      <rect x="44" y="228" width="196" height="20" rx="10" fill="#fef2f2" stroke="#fecaca" strokeWidth="1" />
      <path d="M54 244 L60 233 L66 244 Z" fill="none" stroke="#dc2626" strokeWidth="1.4" strokeLinejoin="round" />
      <text x="60" y="240" fill="#dc2626" fontSize="6" fontWeight="700" textAnchor="middle">!</text>
      <text x="72" y="242" fill="#dc2626" fontSize="10" fontWeight="600">Predictive: schedule slip rising</text>

      {/* human-approved action proposal */}
      <rect x="24" y="266" width="452" height="36" rx="18" fill="#eef2ff" stroke="#c7d2fe" strokeWidth="1" />
      <path d="M46 278 L46.9 282.5 L51 283.4 L46.9 284.3 L46 289 L45.1 284.3 L41 283.4 L45.1 282.5 Z" fill="#4f46e5" />
      <text x="60" y="288" fill="#4338ca" fontSize="11" fontWeight="600">Propose: tidy the schedule — runs only after you approve</text>
      <rect x="392" y="274" width="72" height="20" rx="10" fill="url(#ma-brand)" />
      <text x="428" y="288" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="700">Review</text>
    </svg>
  );
}
