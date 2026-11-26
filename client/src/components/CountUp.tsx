import { useState, useEffect, useRef } from 'react';

// Shared across the per-project Overview hero and the portfolio bento so both speak one motion
// language. Kept tiny and dependency-free.

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Count a number up from 0 on mount — a small "live" flourish for a hero's focal figure. Honours
// prefers-reduced-motion (renders the final value immediately). `format` keeps the caller in control
// of how the running value prints (rounding, suffix, …).
export function CountUp({ to, duration = 900, format = (n: number) => String(Math.round(n)) }: { to: number; duration?: number; format?: (n: number) => string }) {
  const [v, setV] = useState(() => (prefersReducedMotion() ? to : 0));
  const target = useRef(to);
  target.current = to;
  useEffect(() => {
    if (prefersReducedMotion()) { setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(target.current * (1 - Math.pow(1 - p, 3))); // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{format(v)}</>;
}

export default CountUp;
