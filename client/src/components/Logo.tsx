// PRIMA brandmark — a precise arrow striking the centre of a target.
//   target + bullseye  → Ketepatan (precision)
//   the rising arrow   → Ketangkasan (agility) & Komitmen (commitment to the goal)
//   the whole, solid badge + ring → Kepercayaan (trust)
// Self-contained SVG (carries the coral theme colour); white marks read on light & dark.
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="PRIMA" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="primaGrad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f4675f" />
          <stop offset="1" stopColor="#be3b39" />
        </linearGradient>
      </defs>
      {/* badge */}
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#primaGrad)" />
      {/* target ring + bullseye (precision / trust) */}
      <circle cx="24" cy="16" r="6.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeOpacity="0.95" />
      <circle cx="24" cy="16" r="2.2" fill="#fff" />
      {/* rising arrow striking the centre (agility / commitment) */}
      <path d="M24 39 V20" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M19 25 L24 18.5 L29 25" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
