import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Forecast, Project } from '../api/types';
import { formatDateInput, formatIdr } from '../lib/format';
import { IconWallet } from './icons';

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

  // The chip shows the PLANNED margin (Revenue − BAC), which is fixed. The popover also
  // surfaces the PROJECTED margin (Revenue − EAC) so the user can see how the forecast erodes
  // (or improves) the margin as actual cost accrues. Fetched only when the popover is open.
  const { data: forecast } = useQuery({
    queryKey: ['forecast', project.id, formatDateInput(new Date())],
    queryFn: () => api.get<Forecast>(`/projects/${project.id}/forecast?statusDate=${formatDateInput(new Date())}`),
    enabled: open,
  });
  const projected = forecast?.hasData ? forecast.margin.projected : null;
  const projectedDelta = projected != null && margin != null ? projected - margin : null;

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
        <IconWallet className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
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
            label="Planned margin"
            value={margin != null ? formatIdr(margin) : '—'}
            tone={margin != null ? (margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : undefined}
          />
          {/* Forecast margin (Revenue − EAC) — moves with progress/CPI. Only shown once there's
              actuals to forecast from; otherwise it just equals the planned margin. */}
          {projected != null ? (
            <div className="flex items-baseline justify-between gap-6 py-1">
              <span className="text-slate-500 dark:text-slate-400">
                Projected <span className="text-slate-400 dark:text-slate-500">(forecast)</span>
              </span>
              <span className={`font-medium tabular-nums ${projected < 0 ? 'text-red-600 dark:text-red-400' : projected < (margin ?? 0) ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {formatIdr(projected)}
                {projectedDelta != null && projectedDelta !== 0 && (
                  <span className="ml-1 text-[10px] font-normal">({projectedDelta < 0 ? '↓' : '↑'} {formatIdr(Math.abs(projectedDelta))})</span>
                )}
              </span>
            </div>
          ) : (
            <div className="py-1 text-[10px] italic text-slate-400 dark:text-slate-500">Projected margin appears once progress &amp; actual cost are recorded.</div>
          )}
        </div>
      )}
    </div>
  );
}
