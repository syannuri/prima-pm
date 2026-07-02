// Prismatix brandmark — a prism refracting white light into a colour spectrum.
//   glass prism (triangle)  → clarity / focus
//   incoming white beam     → scattered, raw project inputs
//   refracted spectrum fan  → one view split into every facet (schedule · cost · risk · …)
// Self-contained SVG; reads on light & dark. The spectrum reuses the app's semantic
// palette (coral is one facet — tying the coral UI accent into the Prismatix spectrum).
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Prismatix" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pxBadge" x1="6" y1="3" x2="42" y2="45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id="pxGloss" x1="24" y1="2" x2="24" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="pxClip"><rect x="2" y="2" width="44" height="44" rx="13" /></clipPath>
      </defs>

      {/* glossy badge */}
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#pxBadge)" />
      <g clipPath="url(#pxClip)">
        <ellipse cx="24" cy="5" rx="27" ry="15" fill="url(#pxGloss)" />
        {/* incoming white light beam (hidden under the prism where they meet) */}
        <rect x="3" y="22.7" width="13" height="2.6" rx="1.3" fill="#fff" fillOpacity="0.9" />
        {/* refracted spectrum fan — emerges to the right of the prism */}
        <g strokeWidth="2.4" strokeLinecap="round" fill="none">
          <path d="M22 24 L44 15" stroke="#f8776f" />
          <path d="M22 24 L44 19.5" stroke="#fbbf24" />
          <path d="M22 24 L44 24" stroke="#34d399" />
          <path d="M22 24 L44 28.5" stroke="#38bdf8" />
          <path d="M22 24 L44 33" stroke="#a78bfa" />
        </g>
      </g>

      {/* glass prism (drawn on top: cleanly splits beam ➜ spectrum) */}
      <path d="M22 11 L33 31 H11 Z" fill="#fff" fillOpacity="0.95" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
