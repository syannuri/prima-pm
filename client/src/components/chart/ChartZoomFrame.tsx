import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Modal } from '../ui';

// The custom S-curve SVGs use a fixed viewBox (720×H) stretched to the container width
// (preserveAspectRatio="none"), with left/right plot padding of 8/12 viewBox units. The plot
// area in real pixels is therefore [PADL/VBW·w, w − PADR/VBW·w] — the frame maps time↔pixel on
// that so the crosshair, drag-to-zoom selection and tooltip line up with the drawn curve.
const PADL = 8, PADR = 12, VBW = 720;

export type ChartViewport = {
  domain: [number, number];      // visible time window (zooming shrinks it)
  hoverTime: number | null;      // time under the pointer (for the tooltip); null when not hovering
  hoverPx: number | null;        // pointer x within the plot, in px
  zoomed: boolean;
  timeToPx: (t: number) => number;
  width: number;
};

type Props = {
  fullDomain: [number, number];
  title: ReactNode;
  legend?: ReactNode;
  ariaLabel?: string;
  bare?: boolean; // drop the outer card (border/bg/padding) when embedded in an existing Card
  footer?: (vp: ChartViewport) => ReactNode;
  tooltip?: (vp: ChartViewport & { hoverTime: number }) => ReactNode;
  children: (vp: ChartViewport) => ReactNode;
};

// Reusable zoom / pan-scrub / tooltip wrapper for the hand-rolled S-curve charts (no charting
// lib). Hold-and-drag horizontally to zoom into a time range, double-click to reset, hover to
// read the values at a point, and ⤢ to open an enlarged view.
export default function ChartZoomFrame(props: Props) {
  const [enlarged, setEnlarged] = useState(false);
  return (
    <>
      <ChartBody {...props} onEnlarge={() => setEnlarged(true)} />
      {enlarged && (
        <Modal onClose={() => setEnlarged(false)} title={props.title} size="lg" panelClassName="!max-w-5xl">
          <ChartBody {...props} title={null} enlarged />
        </Modal>
      )}
    </>
  );
}

function ChartBody({ fullDomain, title, legend, ariaLabel, bare, footer, tooltip, children, onEnlarge, enlarged }: Props & { onEnlarge?: () => void; enlarged?: boolean }) {
  const [f0, f1] = fullDomain;
  const [domain, setDomain] = useState<[number, number]>([f0, f1]);
  useEffect(() => { setDomain([f0, f1]); }, [f0, f1]);

  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1));
    ro.observe(el);
    setWidth(el.clientWidth || 1);
    return () => ro.disconnect();
  }, []);

  const [hoverPx, setHoverPx] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ start: number; cur: number } | null>(null);

  const left = (PADL / VBW) * width;
  const right = width - (PADR / VBW) * width;
  const plot = Math.max(1, right - left);
  const [d0, d1] = domain;
  const timeToPx = (t: number) => left + ((t - d0) / Math.max(1, d1 - d0)) * plot;
  const pxToTime = (px: number) => d0 + Math.min(1, Math.max(0, (px - left) / plot)) * (d1 - d0);
  const zoomed = d0 !== f0 || d1 !== f1;
  const hoverTime = hoverPx != null ? pxToTime(hoverPx) : null;
  const vp: ChartViewport = { domain, hoverTime, hoverPx, zoomed, timeToPx, width };

  const relX = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? Math.min(width, Math.max(0, e.clientX - r.left)) : 0;
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const x = relX(e);
    setDrag({ start: x, cur: x });
    setHoverPx(x);
  };
  const onMove = (e: React.PointerEvent) => {
    const x = relX(e);
    setHoverPx(x);
    setDrag((d) => (d ? { ...d, cur: x } : d));
  };
  const onUp = () => {
    if (drag) {
      const a = pxToTime(Math.min(drag.start, drag.cur));
      const b = pxToTime(Math.max(drag.start, drag.cur));
      if (Math.abs(drag.cur - drag.start) > 8 && b > a) setDomain([a, b]);
    }
    setDrag(null);
  };
  const onLeave = () => { setHoverPx(null); setDrag(null); };
  const reset = () => setDomain([f0, f1]);

  // Tooltip box position: follow the pointer, flipping to the left near the right edge.
  const tipContent = hoverTime != null && tooltip ? tooltip({ ...vp, hoverTime }) : null;
  const tipLeft = hoverPx != null ? (hoverPx > width * 0.6 ? undefined : hoverPx + 12) : undefined;
  const tipRight = hoverPx != null && hoverPx > width * 0.6 ? width - hoverPx + 12 : undefined;

  return (
    <div className={bare && !enlarged ? '' : 'rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          {title && <div className="rounded-md border-l-4 border-brand-500 bg-brand-50 px-2 py-1 text-sm font-bold text-slate-800 dark:bg-brand-500/10 dark:text-white">{title}</div>}
          {zoomed && (
            <button onClick={reset} className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">Reset zoom</button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {legend && <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">{legend}</div>}
          {onEnlarge && (
            <button onClick={onEnlarge} title="Enlarge" aria-label="Enlarge chart" className="rounded-md border border-slate-200 px-1.5 py-0.5 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">⤢</button>
          )}
        </div>
      </div>

      <div
        ref={ref}
        className="relative select-none"
        style={{ touchAction: 'none', cursor: drag ? 'ew-resize' : 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onLeave}
        onDoubleClick={reset}
        role="img"
        aria-label={ariaLabel}
      >
        {children(vp)}

        {/* Crosshair + drag-to-zoom selection overlay (pointer-events pass through to the div above) */}
        {drag && Math.abs(drag.cur - drag.start) > 2 && (
          <div className="pointer-events-none absolute top-0 bottom-6 bg-brand-500/15 border-x border-brand-400/50" style={{ left: Math.min(drag.start, drag.cur), width: Math.abs(drag.cur - drag.start) }} />
        )}
        {hoverPx != null && !drag && (
          <div className="pointer-events-none absolute top-0 bottom-6 w-px bg-slate-400/60 dark:bg-slate-500/60" style={{ left: hoverPx }} />
        )}
        {tipContent && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95"
            style={{ left: tipLeft, right: tipRight }}
          >
            {tipContent}
          </div>
        )}
      </div>

      {footer && footer(vp)}
      {!enlarged && <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">Drag to zoom · double-click to reset · hover to read values · ⤢ to enlarge</p>}
    </div>
  );
}

// Shared helper: index of the point in `times` nearest to `t`.
export function nearestIndex(times: number[], t: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - t);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
