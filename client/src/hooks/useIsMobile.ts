import { useEffect, useState } from 'react';

// True when the viewport is phone-width (< 640px = Tailwind's `sm` breakpoint).
// Guards matchMedia so it's safe under SSR / jsdom (returns false → desktop layout).
export function useIsMobile(query = '(max-width: 639px)'): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [isMobile, setIsMobile] = useState(() => (supported ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!supported) return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query, supported]);
  return isMobile;
}
