import { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { GanttNode } from '../api/types';
import { Button, Modal } from './ui';
import { useToast } from './Toast';

// Phase-weight editor (Model B). Lists the TOP-LEVEL WBS phases and lets a PMO set a manual
// weight on each — the contractual "weight table" workflow. A live total + "Normalize to 100"
// button and a partial-weighting warning keep the numbers coherent: mixing manual weights on
// some phases with auto (cost/duration) on others silently distorts the roll-up, so we flag it
// and offer the one-click fix. Weights feed the SAME EV engine — this is just a friendlier way
// to set the per-task `weight` the row-level Weight column already edits.

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

export default function WeightEditorModal({
  base,
  phases,
  baselined,
  onClose,
  onSaved,
}: {
  base: string; // /projects/:id/schedule
  phases: GanttNode[]; // top-level nodes (the tree roots)
  baselined: boolean; // a schedule baseline exists → weights are frozen for EVM until re-baseline
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(phases.map((p) => [p.id, p.weight != null ? String(p.weight) : ''])),
  );
  const [busy, setBusy] = useState(false);

  const entered = useMemo(() => phases.map((p) => num(vals[p.id] ?? '')), [phases, vals]);
  const total = useMemo(() => entered.reduce((s: number, n) => s + (n ?? 0), 0), [entered]);
  const setCount = entered.filter((n) => n != null).length;
  const partial = setCount > 0 && setCount < phases.length; // some weighted, some auto → scale clash
  const sumsTo100 = setCount === phases.length && Math.abs(total - 100) < 0.05;

  // Normalize: every phase adopts an explicit weight — its entered value if set, else its current
  // effective share — then all are rescaled to sum to 100. Clears blanks AND the partial state.
  const normalize = () => {
    const bases = phases.map((p, i) => entered[i] ?? p.effectiveWeightPct);
    const sum = bases.reduce((s, n) => s + n, 0);
    const next: Record<string, string> = {};
    phases.forEach((p, i) => {
      next[p.id] = String(sum > 0 ? round1((bases[i] / sum) * 100) : round1(100 / phases.length));
    });
    setVals(next);
  };

  const clearAll = () => setVals(Object.fromEntries(phases.map((p) => [p.id, ''])));

  const save = async () => {
    setBusy(true);
    try {
      const changed = phases.filter((p, i) => (entered[i] ?? null) !== (p.weight ?? null));
      await Promise.all(
        changed.map((p) => {
          const w = num(vals[p.id] ?? '');
          return api.put(`${base}/tasks/${p.id}`, {
            name: p.name, planStart: p.planStart, planEnd: p.planEnd,
            progressPct: p.progressPct, isMilestone: p.isMilestone, weight: w,
            parentTaskId: p.parentTaskId, sortOrder: p.sortOrder,
            picUserId: p.picUserId ?? undefined, picResourceId: p.picResourceId ?? undefined,
            description: p.description ?? null, deliverable: p.deliverable ?? null, acceptanceCriteria: p.acceptanceCriteria ?? null,
            actualStart: p.actualStart ?? undefined, actualFinish: p.actualFinish ?? undefined,
          });
        }),
      );
      toast.success(changed.length ? `Updated ${changed.length} phase weight${changed.length === 1 ? '' : 's'}` : 'No changes');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save weights');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Phase weights" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Set a relative <strong>weight</strong> on each top-level phase to steer the overall
          project&nbsp;%. A phase&apos;s weight is shared across its tasks — leave a phase{' '}
          <em>blank</em> to weight it automatically by cost/duration. Weights feed the same EVM
          engine, so this is the number that drives % complete, SPI and forecasts.
        </p>

        {baselined && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-300">
            <strong>A schedule baseline is set.</strong> The project&nbsp;% is measured against the
            <em> baseline</em> weights (the &quot;Now&quot; column). Edits here update the plan but
            only take effect once you <strong>re-capture the schedule baseline</strong> — so
            re-planning weights can&apos;t silently re-base EV.
          </div>
        )}

        {partial && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            <strong>Some phases are weighted and some are auto.</strong> Manual weights and
            auto (duration) weights are on different scales, so the mix can distort the roll-up.
            Weight <em>every</em> phase, or click <strong>Normalize to 100</strong> to make them
            explicit and consistent.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                <th className="px-3 py-2">WBS</th>
                <th className="px-3 py-2">Phase</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2 text-right" title="Current effective share of the whole project">Now</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-xs text-slate-400 dark:text-slate-500">{p.wbsCode}</td>
                  <td className="px-3 py-1.5">{p.name}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number" min={0} step="any" value={vals[p.id] ?? ''} placeholder="auto"
                      aria-label={`Weight for ${p.name}`}
                      onChange={(e) => setVals((v) => ({ ...v, [p.id]: e.target.value }))}
                      className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums placeholder:text-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-600"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-400 dark:text-slate-500">{p.effectiveWeightPct}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                <td className="px-3 py-2" colSpan={2}>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {setCount} of {phases.length} phase{phases.length === 1 ? '' : 's'} weighted
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  <span className={sumsTo100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}>
                    {round1(total)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-400 dark:text-slate-500">
                  {sumsTo100 ? '✓ 100' : setCount === phases.length ? 'of 100' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={normalize} disabled={busy}>Normalize to 100</Button>
            <Button variant="ghost" onClick={clearAll} disabled={busy}>Clear all</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save weights'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
