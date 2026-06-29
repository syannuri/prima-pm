// Precise brandmark — a modern, glossy precision reticle.
//   layered ring + centre dot → Ketepatan / akurasi (precision, focus-lock)
//   four ticks                 → penyelarasan ke target
//   glossy gradient badge      → tampilan modern + Kepercayaan (trust)
// Self-contained SVG (carries the coral theme colour); white marks read on light & dark.
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Precise" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="preciseGrad" x1="6" y1="3" x2="42" y2="45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb7d77" />
          <stop offset="0.5" stopColor="#f4675f" />
          <stop offset="1" stopColor="#be3b39" />
        </linearGradient>
        <linearGradient id="preciseGloss" x1="24" y1="2" x2="24" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="preciseBadge">
          <rect x="2" y="2" width="44" height="44" rx="13" />
        </clipPath>
      </defs>

      {/* glossy gradient badge */}
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#preciseGrad)" />
      <g clipPath="url(#preciseBadge)">
        <ellipse cx="24" cy="5" rx="27" ry="15" fill="url(#preciseGloss)" />
      </g>

      {/* layered precision reticle */}
      <circle cx="24" cy="24" r="13" fill="none" stroke="#fff" strokeWidth="1.3" strokeOpacity="0.45" />
      <circle cx="24" cy="24" r="9" fill="none" stroke="#fff" strokeWidth="2.4" strokeOpacity="0.95" />
      <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeOpacity="0.95">
        <path d="M24 7 V11.5" />
        <path d="M24 36.5 V41" />
        <path d="M7 24 H11.5" />
        <path d="M36.5 24 H41" />
      </g>
      <circle cx="24" cy="24" r="3" fill="#fff" />
    </svg>
  );
}
