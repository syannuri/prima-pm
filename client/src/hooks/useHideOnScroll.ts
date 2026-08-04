import { useEffect, useState } from 'react';

// Returns true while the user is scrolling DOWN (past a small threshold) so floating overlays
// — the chat bubble + the New-Project FAB — can slide out of the way instead of permanently
// covering bottom-right content (e.g. the Cost variance KPI tile on the mobile dashboard).
// The app scrolls an inner `<main>` container, not `window`, so we listen on that (falling back
// to window if it's ever missing). Re-shows the moment the user scrolls up or stops near the top.
export function useHideOnScroll(threshold = 120): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el: HTMLElement | Window = document.querySelector('main') ?? window;
    const getY = () => (el instanceof Window ? window.scrollY : el.scrollTop);
    let last = getY();
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = getY();
        if (y < threshold) setHidden(false);          // always visible near the top
        else if (y > last + 6) setHidden(true);        // scrolling down → hide
        else if (y < last - 6) setHidden(false);       // scrolling up → show
        last = y;
        ticking = false;
      });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return hidden;
}
