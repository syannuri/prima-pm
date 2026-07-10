import { useEffect, useRef, useState, type ReactNode } from 'react';

// Touch pull-to-refresh for the mobile dashboard. Wraps content; when the
// nearest scroll container is at the top and the user drags down past a
// threshold, it calls onRefresh() and shows a spinner. Uses native
// non-passive listeners so it can preventDefault (React's touch handlers are
// passive). Desktop is inert (no touch events).
const THRESHOLD = 64; // translateY px needed to trigger
const MAX = 96; // clamp
const REST = 40; // spinner resting height while refreshing

function scrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Refs mirror render state so the once-attached listeners never go stale.
  const pv = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const setP = (v: number) => { pv.current = v; setPull(v); };

  useEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    const st = { active: false, startY: 0, pulling: false };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      const sc = scrollableAncestor(wrap);
      if (!sc || sc.scrollTop > 0) return;
      st.active = true;
      st.pulling = false;
      st.startY = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!st.active) return;
      const sc = scrollableAncestor(wrap);
      if (sc && sc.scrollTop > 0) { st.active = false; if (st.pulling) { setDragging(false); setP(0); } return; }
      const dy = e.touches[0].clientY - st.startY;
      if (dy <= 0) { if (st.pulling) { setDragging(false); setP(0); } st.active = false; return; }
      if (!st.pulling) { st.pulling = true; setDragging(true); }
      e.preventDefault(); // hold back native scroll/overscroll while pulling
      setP(Math.min(MAX, dy * 0.5)); // resistance
    };
    const onEnd = () => {
      if (!st.active && !st.pulling) return;
      st.active = false;
      st.pulling = false;
      setDragging(false);
      if (pv.current >= THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        setP(REST);
        Promise.all([
          Promise.resolve(onRefreshRef.current()).catch(() => {}),
          new Promise((r) => setTimeout(r, 600)), // let the spinner breathe
        ]).finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          setP(0);
        });
      } else {
        setP(0);
      }
    };

    wrap.addEventListener('touchstart', onStart, { passive: true });
    wrap.addEventListener('touchmove', onMove, { passive: false });
    wrap.addEventListener('touchend', onEnd);
    wrap.addEventListener('touchcancel', onEnd);
    return () => {
      wrap.removeEventListener('touchstart', onStart);
      wrap.removeEventListener('touchmove', onMove);
      wrap.removeEventListener('touchend', onEnd);
      wrap.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div ref={ref} data-pull-refresh className="relative">
      {/* Pull indicator — sits in the revealed space above the content */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-end justify-center overflow-hidden"
        style={{ height: pull }}
      >
        <span
          className="mb-2 grid h-9 w-9 place-items-center rounded-full bg-white text-brand-600 shadow-md ring-1 ring-black/5 dark:bg-slate-800 dark:text-brand-400"
          style={{ opacity: refreshing ? 1 : progress }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            // Arrow points down while pulling, flips up once past the threshold
            // ("release to refresh"); swapped for a spinner arc while refreshing.
            style={refreshing ? undefined : { transform: `rotate(${progress >= 1 ? 180 : 0}deg)`, transition: 'transform .18s ease' }}
          >
            {refreshing ? <path d="M21 12a9 9 0 1 1-6.2-8.6" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
          </svg>
        </span>
      </div>
      <div style={{ transform: `translateY(${pull}px)`, transition: dragging ? 'none' : 'transform .25s ease' }}>
        {children}
      </div>
    </div>
  );
}
