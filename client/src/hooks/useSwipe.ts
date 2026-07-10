import { useEffect, type RefObject } from 'react';
import { haptic } from '../lib/haptics';

// Horizontal swipe detector for a container. Fires onLeft (swipe →← , next) or
// onRight (swipe ←→, previous) only when the gesture is clearly horizontal —
// so it never hijacks vertical scrolling or the pull-to-refresh. Touch only;
// desktop is inert. Attaches native listeners (no preventDefault needed since
// we let horizontal browser scroll pass unless we act).
const DIST = 60; // min horizontal travel (px)
const RATIO = 1.6; // |dx| must beat |dy| by this factor to count as horizontal

export function useSwipe(
  ref: RefObject<HTMLElement>,
  { onLeft, onRight, enabled = true }: { onLeft?: () => void; onRight?: () => void; enabled?: boolean },
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let x0 = 0;
    let y0 = 0;
    let tracking = false;

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    };
    const end = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) < DIST || Math.abs(dx) < Math.abs(dy) * RATIO) return; // not a horizontal swipe
      if (dx < 0) { haptic(); onLeft?.(); }
      else { haptic(); onRight?.(); }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchend', end);
    };
  }, [ref, onLeft, onRight, enabled]);
}
