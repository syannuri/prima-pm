import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { TaskStep } from '../api/types';
import { Button, Modal, Spinner } from './ui';
import { useToast } from './Toast';

// Weighted progress steps (#5, P6-style): define the sub-deliverables of a work package with a
// weight each; the task's % complete is DERIVED from Σ(done weights)/Σ(weights). Turns a subjective
// "how done is this?" into an objective tally of completed steps.

interface Draft { name: string; weight: string; done: boolean }
const toDraft = (s: TaskStep): Draft => ({ name: s.name, weight: String(s.weight), done: s.done });
const wnum = (s: string) => { const n = Number(s.trim()); return Number.isFinite(n) && n >= 0 ? n : 0; };

export default function StepsModal({
  base,
  taskId,
  taskName,
  canEdit,
  onClose,
  onSaved,
}: {
  base: string; // /projects/:id/schedule
  taskId: string;
  taskName: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [steps, setSteps] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);

  useQuery({
    queryKey: ['task-steps', taskId],
    queryFn: async () => {
      const res = await api.get<{ steps: TaskStep[] }>(`${base}/tasks/${taskId}/steps`);
      setSteps(res.steps.map(toDraft));
      return res.steps;
    },
  });

  const derivedPct = useMemo(() => {
    if (!steps || !steps.length) return 0;
    const total = steps.reduce((s, x) => s + wnum(x.weight), 0);
    if (total <= 0) return 0;
    const done = steps.reduce((s, x) => s + (x.done ? wnum(x.weight) : 0), 0);
    return Math.round((done / total) * 100);
  }, [steps]);

  const set = (i: number, patch: Partial<Draft>) => setSteps((s) => (s ? s.map((x, j) => (j === i ? { ...x, ...patch } : x)) : s));
  const add = () => setSteps((s) => [...(s ?? []), { name: '', weight: '1', done: false }]);
  const remove = (i: number) => setSteps((s) => (s ? s.filter((_, j) => j !== i) : s));

  const save = async () => {
    if (!steps) return;
    const clean = steps.map((s) => ({ name: s.name.trim(), weight: wnum(s.weight), done: s.done })).filter((s) => s.name.length > 0);
    setBusy(true);
    try {
      await api.put(`${base}/tasks/${taskId}/steps`, { steps: clean });
      toast.success(clean.length ? `Saved ${clean.length} step${clean.length === 1 ? '' : 's'} — ${derivedPct}% complete` : 'Steps cleared');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save steps');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Progress steps" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Break <strong>{taskName}</strong> into weighted sub-deliverables. The task&apos;s{' '}
          <strong>% complete is derived</strong> from the done steps&apos; weights, so progress is an
          objective tally instead of a guess. Clear all steps to go back to a manual %.
        </p>

        {steps == null ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                    <th className="px-3 py-2 w-10 text-center">Done</th>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2 text-right w-24">Weight</th>
                    {canEdit && <th className="px-2 py-2 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {steps.length === 0 && (
                    <tr><td colSpan={canEdit ? 4 : 3} className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">No steps yet — add sub-deliverables to measure progress objectively.</td></tr>
                  )}
                  {steps.map((s, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" checked={s.done} disabled={!canEdit} onChange={(e) => set(i, { done: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800" aria-label={`Mark "${s.name || 'step'}" done`} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="text" value={s.name} disabled={!canEdit} placeholder="Sub-deliverable" onChange={(e) => set(i, { name: e.target.value })}
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm disabled:border-transparent disabled:bg-transparent dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" min={0} step="any" value={s.weight} disabled={!canEdit} onChange={(e) => set(i, { weight: e.target.value })}
                          className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:border-transparent disabled:bg-transparent dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" aria-label={`Weight for "${s.name || 'step'}"`} />
                      </td>
                      {canEdit && (
                        <td className="px-2 py-1.5 text-center">
                          <button type="button" onClick={() => remove(i)} title="Remove step" className="text-slate-400 hover:text-rose-500">✕</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                    <td className="px-3 py-2 text-center text-xs text-slate-500 dark:text-slate-400">{steps.filter((s) => s.done).length}/{steps.length}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Derived % complete</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-700 dark:text-brand-300">{derivedPct}%</td>
                    {canEdit && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2">
              {canEdit ? <Button variant="secondary" onClick={add} disabled={busy}>+ Add step</Button> : <span />}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                {canEdit && <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save steps'}</Button>}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
