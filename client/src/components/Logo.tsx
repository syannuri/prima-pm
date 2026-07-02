// Prismatix brandmark — a badge-less modern 3D prism (no container box; transparent).
//   two coral facets (lit + shadow) + gradient give depth; a soft white edge = light on glass.
// Renders on light & dark backgrounds (coral is a mid-tone). Self-contained SVG, so it
// scales crisply; a transparent PNG export lives at client/public/logo.png (+ @1024).
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Prismatix" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pxLit" x1="8" y1="8" x2="24" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff8f88" />
          <stop offset="1" stopColor="#f4675f" />
        </linearGradient>
        <linearGradient id="pxDim" x1="24" y1="8" x2="41" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e3564e" />
          <stop offset="1" stopColor="#b23a37" />
        </linearGradient>
      </defs>
      {/* lit (left) facet */}
      <path d="M24 5 L7.5 42 H24 Z" fill="url(#pxLit)" stroke="#f4675f" strokeWidth="1.6" strokeLinejoin="round" />
      {/* shadow (right) facet — the fold gives the prism its 3D read */}
      <path d="M24 5 L40.5 42 H24 Z" fill="url(#pxDim)" stroke="#b23a37" strokeWidth="1.6" strokeLinejoin="round" />
      {/* soft light highlight down the lit edge */}
      <path d="M24 6 L12.5 32" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
