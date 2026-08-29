import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Badge, Button, Modal } from './ui';
import { useToast } from './Toast';
import GuestAiNote, { useIsGuest } from './GuestAiNote';

// Stage A — extract structured updates from free-text notes, then apply the ones the PM keeps via
// the existing write endpoints (audited, permission-checked). The AI only drafts; nothing is
// auto-applied.
interface ProgressUpdate { taskId: string; taskWbsCode: string; taskName: string; currentPct: number; newPct: number }
interface IssueDraft { title: string; description: string; category: string; impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }
interface Draft { progressUpdates: ProgressUpdate[]; issues: IssueDraft[] }

const IMPACT_COLOR: Record<IssueDraft['impact'], string> = { LOW: 'slate', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red' };

export default function ExtractFromNotes({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pctById, setPctById] = useState<Record<string, number>>({}); // editable target %
  const [pickTasks, setPickTasks] = useState<Set<string>>(new Set());
  const [pickIssues, setPickIssues] = useState<Set<number>>(new Set());

  const isGuest = useIsGuest();
  const aiQ = useQuery({
    queryKey: ['ai-available', projectId],
    queryFn: () => api.get<{ aiAvailable: boolean }>(`/projects/${projectId}/ai-available`),
    staleTime: 5 * 60_000,
  });

  const extract = useMutation({
    mutationFn: () => api.post<Draft>(`/projects/${projectId}/data-extract/ai-draft`, { text }),
    onSuccess: (d) => {
      setDraft(d);
      setPctById(Object.fromEntries(d.progressUpdates.map((u) => [u.taskId, u.newPct])));
      setPickTasks(new Set(d.progressUpdates.map((u) => u.taskId)));
      setPickIssues(new Set(d.issues.map((_, i) => i)));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'AI could not extract data'),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!draft) return { tasks: 0, issues: 0 };
      let tasks = 0, issues = 0;
      // Sequential — keeps audit ordering clean and avoids risk-code-style collisions on issues.
      for (const u of draft.progressUpdates) {
        if (!pickTasks.has(u.taskId)) continue;
        await api.patch(`/projects/${projectId}/schedule/tasks/${u.taskId}/progress`, { progressPct: pctById[u.taskId] ?? u.newPct });
        tasks++;
      }
      for (let i = 0; i < draft.issues.length; i++) {
        if (!pickIssues.has(i)) continue;
        const it = draft.issues[i];
        await api.post(`/projects/${projectId}/issues`, { title: it.title, description: it.description, category: it.category, impact: it.impact });
        issues++;
      }
      return { tasks, issues };
    },
    onSuccess: ({ tasks, issues }) => {
      ['gantt', 'issues', 'evm', 'forecast', 'project', 'risks'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Applied: ${tasks} progress updates, ${issues} issues.`);
      close();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to apply some items'),
  });

  const close = () => { setOpen(false); setText(''); setDraft(null); };

  if (!aiQ.data?.aiAvailable) return isGuest ? <GuestAiNote /> : null;

  const toggleTask = (id: string) => setPickTasks((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleIssue = (i: number) => setPickIssues((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const chosenCount = pickTasks.size + pickIssues.size;

  return (
    <>
      <div className="flex justify-end">
        <Button variant="secondary" className="!py-1 text-xs" onClick={() => setOpen(true)}>✨ Extract from notes</Button>
      </div>

      {open && (
        <Modal onClose={close} title="Extract from notes (AI)" size="lg">
          <div className="space-y-3">
            {!draft ? (
              <>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Paste meeting minutes or a status report. The AI will extract task progress updates (mapped to the project WBS) and new issues. You review &amp; approve before anything is applied.
                </p>
                <textarea
                  rows={8}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste notes here…"
                  className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={close}>Cancel</Button>
                  <Button disabled={text.trim().length < 5 || extract.isPending} onClick={() => extract.mutate()}>
                    {extract.isPending ? 'Extracting…' : 'Extract'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-500 dark:text-slate-400">Check the items you want to apply. AI results can be wrong — review before approving.</p>

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Task progress updates</div>
                  {draft.progressUpdates.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500">None.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {draft.progressUpdates.map((u) => (
                        <li key={u.taskId}>
                          <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                            <input type="checkbox" className="h-4 w-4 shrink-0" checked={pickTasks.has(u.taskId)} onChange={() => toggleTask(u.taskId)} />
                            <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200"><span className="font-mono text-xs text-slate-400">{u.taskWbsCode}</span> {u.taskName}</span>
                            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{u.currentPct}% →</span>
                            <input type="number" min={0} max={100} value={pctById[u.taskId] ?? u.newPct}
                              onChange={(e) => setPctById((p) => ({ ...p, [u.taskId]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                              className="w-16 shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm dark:border-slate-700 dark:bg-slate-800" />
                            <span className="shrink-0 text-xs text-slate-400">%</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">New issues</div>
                  {draft.issues.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500">None.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {draft.issues.map((it, i) => (
                        <li key={i}>
                          <label className="flex cursor-pointer gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={pickIssues.has(i)} onChange={() => toggleIssue(i)} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{it.title}</span>
                                <Badge color={IMPACT_COLOR[it.impact]}>{it.impact}</Badge>
                              </div>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{it.category} · {it.description}</p>
                            </div>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
                  <Button variant="secondary" onClick={() => setDraft(null)}>← Edit text</Button>
                  <Button disabled={chosenCount === 0 || apply.isPending} onClick={() => apply.mutate()}>
                    {apply.isPending ? 'Applying…' : `Apply selected (${chosenCount})`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
