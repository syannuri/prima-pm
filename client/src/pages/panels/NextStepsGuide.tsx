import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { NextStep, NextStepsResult } from '../../api/types';

// Where each header lifecycle control lives, so an action cue can point the user to it.
const ACTION_HINT: Record<NonNullable<NextStep['action']>, string> = {
  activate: "Use the “▶ Activate” button at the top of this page.",
  resume: "Use the “▶ Resume” button at the top of this page.",
  close: "Use the “Close project” button at the top of this page.",
};

// A compact, contextual "what to do next" guide driven by the project's lifecycle
// stage (charter → baseline → activate → track → close). Tab cues jump straight to
// the relevant tab; lifecycle-action cues point at the header controls. Renders
// nothing when there's nothing pending (e.g. a closed project).
export default function NextStepsGuide({ projectId, onJump }: { projectId: string; onJump: (tab: string) => void }) {
  const { data } = useQuery({
    queryKey: ['next-steps', projectId],
    queryFn: () => api.get<{ nextSteps: NextStepsResult }>(`/projects/${projectId}/next-steps`).then((r) => r.nextSteps),
  });

  if (!data || !data.steps.length) return null;

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-900/50 dark:bg-brand-900/15">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base">🧭</span>
        <span className="text-sm font-semibold text-brand-800 dark:text-brand-200">Next steps</span>
        <span className="text-xs text-brand-600/80 dark:text-brand-300/70">· {data.stage}</span>
      </div>
      <ol className="space-y-2">
        {data.steps.map((s, i) => (
          <li key={s.key} className="flex items-start gap-3">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${
              i === 0 ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300'
            }`}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{s.title}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">{s.detail}</div>
              {s.action && <div className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">{ACTION_HINT[s.action]}</div>}
            </div>
            {s.tab && (
              <button
                onClick={() => onJump(s.tab!)}
                className="shrink-0 whitespace-nowrap rounded-lg border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-800 dark:bg-slate-900 dark:text-brand-300 dark:hover:bg-slate-800"
              >
                Open {s.tab} →
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
