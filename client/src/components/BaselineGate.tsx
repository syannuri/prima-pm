import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button } from './ui';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { canGovernProject } from '../lib/perms';
import { formatDate } from '../lib/format';
import BaselineLock from './BaselineLock';
import BaselineHistory from './BaselineHistory';

// Lifecycle "baseline gate" chip for the project header. Baselining is a one-time phase-gate
// (Planning → Execution), not a per-tab control, so the trigger lives beside the status badge and
// its prominence is state-adaptive: loud (amber "1/2") while incomplete, quiet (emerald "Baselined")
// once locked. Clicking opens a popover with the two ordered steps — ① capture the schedule baseline,
// ② lock the cost baseline — which reuse the SAME endpoints and embed the existing <BaselineLock>, so
// the EVM-sensitive lock/ordering/weight-freeze logic stays in one place, untouched. This is pure
// relocation of the old top-of-tab BaselineSetupBar; the flow/process is unchanged. onNavigateTab lets
// a step chip jump to the tab that owns it (Schedule for step ①).
export default function BaselineGate({ projectId, onNavigateTab }: { projectId: string; onNavigateTab?: (tab: string) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Same cache keys as BaselineLock / WbsPanel → no extra fetches, and the chip stays in sync as
  // either step completes anywhere in the app.
  const { data } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`),
  });
  const scheduleQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ tree: unknown[]; baselinedAt: string | null }>(`/projects/${projectId}/schedule/gantt`),
  });

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onEsc); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const project = data?.project;
  const locked = !!project?.baselineLockedAt;
  const baselinedAt = scheduleQ.data?.baselinedAt ?? null;
  const hasWbs = (scheduleQ.data?.tree?.length ?? 0) > 0;
  const scheduleDone = !hasWbs || !!baselinedAt; // a WBS project must capture; a plain project has no schedule step
  const needScheduleBaseline = hasWbs && !baselinedAt;
  const canManage = !!project && canGovernProject(user, project, ['ADMIN', 'PMO', 'PROJECT_MANAGER']);
  const stepsDone = (scheduleDone ? 1 : 0) + (locked ? 1 : 0);

  // Step ①: capture the schedule baseline. First-capture only (offered while it's still missing),
  // so there is no destructive re-baseline path from the gate. Mirrors the WbsPanel mutation and copy.
  const setSchedule = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/schedule/baseline`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gantt', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
      qc.invalidateQueries({ queryKey: ['baseline-versions', projectId] });
      toast.success('Schedule baseline set ✓ (1 of 2) — next: lock the cost baseline to finish.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to set baseline'),
  });

  const captureSchedule = async () => {
    if (await confirm({ title: 'Set schedule baseline?', message: 'Capture the current plan dates as the schedule baseline?', confirmLabel: 'Set baseline' })) {
      setSchedule.mutate();
    }
  };

  // The gate is only meaningful once the project is chartered (it then has a schedule/cost to freeze).
  if (!project || project.status === 'DRAFT') return null;

  return (
    <div ref={ref} className="relative">
      {/* Adaptive chip trigger — amber "n/2" while incomplete, quiet emerald "Baselined" once locked. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={locked ? 'Cost & schedule baseline are frozen (PMB/BAC)' : 'Set up the project baseline'}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
          locked
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200/70 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
            : 'bg-amber-100 text-amber-700 hover:bg-amber-200/70 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60'
        }`}
      >
        <span aria-hidden>{locked ? '🔒' : '◐'}</span>
        {locked ? 'Baselined' : `Baseline ${stepsDone}/2`}
        <span aria-hidden className="text-[9px] opacity-70">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          // z-40 clears the sticky tab strip (z-[31]) so the popover paints over it.
          className="absolute left-0 z-40 mt-1.5 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Baseline setup</span>
              {locked ? (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Locked ✓</span>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">{stepsDone} of 2 done</span>
              )}
            </div>
            <BaselineHistory projectId={projectId} />
          </div>

          <div className="flex flex-col gap-2">
            {/* ① Schedule baseline */}
            <Step
              n="1"
              title="Schedule baseline"
              done={scheduleDone}
              status={!hasWbs ? 'No schedule to baseline' : baselinedAt ? `Baselined ${formatDate(baselinedAt)}` : 'Not set'}
              onJump={onNavigateTab && needScheduleBaseline ? () => { setOpen(false); onNavigateTab('Schedule'); } : undefined}
            >
              {canManage && needScheduleBaseline && (
                <Button variant="primary" className="!py-1 text-xs" disabled={setSchedule.isPending} onClick={captureSchedule}>
                  {setSchedule.isPending ? 'Saving…' : 'Set schedule baseline'}
                </Button>
              )}
            </Step>

            {/* ② Cost baseline — reuse the existing lock widget (status pill + Lock/Unlock + modal + the
                ordering hint), so this step's own status stays a plain description, not a duplicate. */}
            <Step
              n="2"
              title="Cost baseline"
              done={locked}
              status={locked ? 'Locked' : 'Freeze cost lines & schedule (PMB/BAC)'}
              onJump={onNavigateTab && scheduleDone && !locked ? () => { setOpen(false); onNavigateTab('Cost'); } : undefined}
            >
              <BaselineLock projectId={projectId} />
            </Step>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, done, status, onJump, children }: { n: string; title: string; done: boolean; status: string; onJump?: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{title}</div>
          {onJump ? (
            <button onClick={onJump} className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">{status} →</button>
          ) : (
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{status}</div>
          )}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 pl-7">{children}</div>}
    </div>
  );
}
