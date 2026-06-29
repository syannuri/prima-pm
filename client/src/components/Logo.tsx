// Precise brandmark — a precision reticle locking onto its centre.
//   ring + centre dot    → Ketepatan / akurasi (precision)
//   the four ticks        → fokus & penyelarasan (locking onto the target)
//   the solid coral badge → Kepercayaan (trust)
// Self-contained SVG (carries the coral theme colour); white marks read on light & dark.
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Precise" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="preciseGrad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f4675f" />
          <stop offset="1" stopColor="#be3b39" />
        </linearGradient>
      </defs>
      {/* badge */}
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#preciseGrad)" />
      {/* target ring */}
      <circle cx="24" cy="24" r="10.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeOpacity="0.95" />
      {/* four reticle ticks pointing inward */}
      <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeOpacity="0.95">
        <path d="M24 6 V12.5" />
        <path d="M24 35.5 V42" />
        <path d="M6 24 H12.5" />
        <path d="M35.5 24 H42" />
      </g>
      {/* centre lock dot */}
      <circle cx="24" cy="24" r="3" fill="#fff" />
    </svg>
  );
}
