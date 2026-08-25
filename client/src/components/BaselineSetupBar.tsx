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

// Unified two-step baseline "setup bar", rendered identically at the top of the Schedule (Timeline)
// and Cost tabs. It frames the order-dependent flow — ① capture the schedule baseline, then ② lock
// the cost baseline — that was previously split across a kebab menu (Schedule) and a small button
// (Cost) with two different verbs. This is presentation only: it reuses the SAME endpoints and
// embeds the existing <BaselineLock> for step ②, so the EVM-sensitive lock/ordering/weight-freeze
// logic stays in one place, untouched. onNavigateTab lets a step chip jump to the tab that owns it.
export default function BaselineSetupBar({ projectId, onNavigateTab }: { projectId: string; onNavigateTab?: (tab: string) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  // Same cache keys as BaselineLock / WbsPanel → no extra fetches, and the bar stays in sync as
  // either step completes anywhere in the app.
  const { data } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`),
  });
  const scheduleQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ tree: unknown[]; baselinedAt: string | null }>(`/projects/${projectId}/schedule/gantt`),
  });

  const project = data?.project;
  const locked = !!project?.baselineLockedAt;
  const baselinedAt = scheduleQ.data?.baselinedAt ?? null;
  const hasWbs = (scheduleQ.data?.tree?.length ?? 0) > 0;
  const scheduleDone = !hasWbs || !!baselinedAt; // a WBS project must capture; a plain project has no schedule step
  const needScheduleBaseline = hasWbs && !baselinedAt;
  const canManage = !!project && canGovernProject(user, project, ['ADMIN', 'PMO', 'PROJECT_MANAGER']);
  const stepsDone = (scheduleDone ? 1 : 0) + (locked ? 1 : 0);

  // Step ①: capture the schedule baseline. First-capture only (offered while it's still missing),
  // so there is no destructive re-baseline path from the bar. Mirrors the WbsPanel mutation and copy.
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

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      {/* Header: title + progress + revision history */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Baseline setup</span>
          {locked ? (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Locked ✓ — cost &amp; schedule frozen</span>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">{stepsDone} of 2 done</span>
          )}
        </div>
        <BaselineHistory projectId={projectId} />
      </div>

      {/* Two ordered steps */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {/* ① Schedule baseline */}
        <Step
          n="1"
          title="Schedule baseline"
          done={scheduleDone}
          status={!hasWbs ? 'No schedule to baseline' : baselinedAt ? `Baselined ${formatDate(baselinedAt)}` : 'Not set'}
          onJump={onNavigateTab && needScheduleBaseline ? () => onNavigateTab('Schedule') : undefined}
        >
          {canManage && needScheduleBaseline && (
            <Button variant="primary" className="!py-1 text-xs" disabled={setSchedule.isPending} onClick={captureSchedule}>
              {setSchedule.isPending ? 'Saving…' : 'Set schedule baseline'}
            </Button>
          )}
        </Step>

        <div className="hidden self-center text-slate-300 dark:text-slate-600 sm:block" aria-hidden>→</div>

        {/* ② Cost baseline — reuse the existing lock widget (status pill + Lock/Unlock + modal + the
            ordering hint), so this step's own status stays a plain description, not a duplicate. */}
        <Step
          n="2"
          title="Cost baseline"
          done={locked}
          status={locked ? 'Locked' : 'Freeze cost lines & schedule (PMB/BAC)'}
          onJump={onNavigateTab && scheduleDone && !locked ? () => onNavigateTab('Cost') : undefined}
        >
          <BaselineLock projectId={projectId} />
        </Step>
      </div>
    </div>
  );
}

function Step({ n, title, done, status, onJump, children }: { n: string; title: string; done: boolean; status: string; onJump?: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      {/* Title row: step badge + name, then a plain-text status/description below. */}
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
      {/* Action row (only when there's a control) — its own line so a wide widget never squeezes the text. */}
      {children && <div className="flex flex-wrap items-center gap-2 pl-7">{children}</div>}
    </div>
  );
}
