import { useEffect, useRef, useState } from 'react';
import type { Project } from '../api/types';
import { formatIdr } from '../lib/format';

// A compact header chip that shows the project Margin at a glance and, on click, opens a small
// popover with the full financial breakdown (Cost Baseline · Revenue · Margin). Those two base
// figures were pulled out of the always-on header meta (they duplicate the Cost tab) — this
// keeps them one click away without re-cluttering the chip row. Closes on outside-click / Esc.
export default function ProjectDetailsPopover({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onEsc); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const baseline = project.costBaselineIdr != null ? Number(project.costBaselineIdr) : null;
  const revenue = project.totalRevenueIdr != null ? Number(project.totalRevenueIdr) : null;
  const margin = baseline != null && revenue != null ? revenue - baseline : null;

  // Nothing financial to show → render nothing (the trigger would be empty).
  if (baseline == null && revenue == null) return null;

  const Row = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div className="flex items-baseline justify-between gap-6 py-1">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`font-medium tabular-nums ${tone ?? 'text-slate-700 dark:text-slate-200'}`}>{value}</span>
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Financial details"
        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <span aria-hidden>💰</span>
        {margin != null ? (
          <><span className="text-slate-400 dark:text-slate-500">Margin</span><span className="font-medium text-slate-700 dark:text-slate-200">{formatIdr(margin)}</span></>
        ) : (
          <span className="font-medium text-slate-700 dark:text-slate-200">Financials</span>
        )}
        <span aria-hidden className="text-[9px] text-slate-400 dark:text-slate-500">▾</span>
      </button>

      {open && (
        <div role="dialog" aria-label="Financial details" className="absolute left-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Financials</div>
          <Row label="Cost Baseline" value={baseline != null ? formatIdr(baseline) : '—'} />
          <Row label="Revenue" value={revenue != null ? formatIdr(revenue) : '—'} />
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <Row
            label="Margin"
            value={margin != null ? formatIdr(margin) : '—'}
            tone={margin != null ? (margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : undefined}
          />
        </div>
      )}
    </div>
  );
}
