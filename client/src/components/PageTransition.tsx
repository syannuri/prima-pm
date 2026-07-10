import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

// Fades the routed content in on each navigation. Keyed by pathname + the
// dashboard `view` param, so real page changes AND the Home⇄Projects view
// swap both replay the animation. Opacity-only (see .prima-page in index.css).
export default function PageTransition({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const view = new URLSearchParams(loc.search).get('view') ?? '';
  return (
    <div key={`${loc.pathname}?${view}`} className="prima-page">
      {children}
    </div>
  );
}
