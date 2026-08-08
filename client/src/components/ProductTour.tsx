import { useEffect, useRef, useState } from 'react';
import HeroMockup from './HeroMockup';
import MockGantt from './mocks/MockGantt';
import MockSCurve from './mocks/MockSCurve';
import MockCharts from './mocks/MockCharts';

// Self-contained "video tour": a framed player that auto-cycles the SVG mockup scenes with a
// cross-fade — the screencast feel, but crisp, light-weight and theme-matched (no video file).
// Honours prefers-reduced-motion (no autoplay, manual dots), and pauses when scrolled off-screen.
type Scene = { Comp: (p: { className?: string }) => JSX.Element; label: string; hint: string };
const SCENES: Scene[] = [
  { Comp: HeroMockup, label: 'Portfolio dashboard', hint: 'Health, cost & schedule at a glance' },
  { Comp: MockGantt, label: 'WBS & Gantt', hint: 'Plan the schedule, track progress' },
  { Comp: MockSCurve, label: 'Earned-Value S-curve', hint: 'PV · EV · AC with SPI & CPI' },
  { Comp: MockCharts, label: 'Portfolio charts', hint: 'Cost & schedule status' },
];
const DUR = 3600; // ms per scene

const PlayIcon = () => <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>;
const PauseIcon = () => <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;

export default function ProductTour({ className }: { className?: string }) {
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(!reduce);
  const [inView, setInView] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView) return;
    const t = setTimeout(() => setI((n) => (n + 1) % SCENES.length), DUR);
    return () => clearTimeout(t);
  }, [i, playing, inView]);

  const active = SCENES[i];
  return (
    <div ref={rootRef} className={className}>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-slate-200">
        {/* window chrome + live caption */}
        <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-100 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          <span className="ml-3 text-sm font-semibold text-slate-700">{active.label}</span>
          <span className="ml-auto hidden text-xs text-slate-400 sm:block">{active.hint}</span>
        </div>
        {/* stage — scenes stacked + cross-faded (fixed aspect so height never jumps; white letterbox
            blends with the light mockups) */}
        <div className="relative aspect-[16/10] bg-white">
          {SCENES.map(({ Comp }, n) => (
            <div key={n} aria-hidden={n !== i} className={`absolute inset-0 transition-opacity duration-700 ${n === i ? 'opacity-100 pmx-scene-in' : 'pointer-events-none opacity-0'}`}>
              <Comp className="h-full w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* controls: play/pause + segmented progress dots */}
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause tour' : 'Play tour'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:text-blue-600"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="flex items-center gap-2">
          {SCENES.map((s, n) => (
            <button
              key={n}
              onClick={() => setI(n)}
              aria-label={`Show ${s.label}`}
              aria-current={n === i}
              className="relative h-2 overflow-hidden rounded-full bg-slate-200 transition-all duration-300"
              style={{ width: n === i ? 40 : 8 }}
            >
              {n === i && (
                <span
                  key={`${i}-${playing}-${inView}`}
                  className="absolute inset-y-0 left-0 rounded-full bg-blue-600"
                  style={{ width: playing && inView && !reduce ? undefined : '100%', animation: playing && inView && !reduce ? `pmx-seg ${DUR}ms linear forwards` : undefined }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
