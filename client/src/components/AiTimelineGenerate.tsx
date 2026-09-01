import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Badge, Button, Field, Input, Modal } from './ui';
import { useToast } from './Toast';
import GuestAiNote, { useIsGuest } from './GuestAiNote';
import { useLang } from '../context/LanguageContext';
import { formatDate, formatDateInput } from '../lib/format';

// AI-generated timeline from the Project Charter. The server returns a whitelisted DRAFT (phases →
// work packages with durations); the PM reviews/edits it here and applies it. Shape mirrors the
// server's ScheduleDraftSchema. Nothing is created until the PM clicks Apply.
interface DraftTask {
  name: string;
  durationDays: number;
  isMilestone?: boolean;
  deliverable?: string | null;
  acceptanceCriteria?: string | null;
  weight?: number | null;
}
interface DraftPhase {
  name: string;
  deliverable?: string | null;
  weight?: number | null;
  tasks: DraftTask[];
}
interface GenerateResponse {
  draft: { phases: DraftPhase[] };
  charter: { scheduleStart: string; scheduleEnd: string; scheduleWorkingDaysBudget: number };
}

// Editable copies carry an `include` flag so the PM can drop phases / tasks before applying.
type ETask = DraftTask & { include: boolean };
type EPhase = Omit<DraftPhase, 'tasks'> & { include: boolean; tasks: ETask[] };

const DAY = 86_400_000;

export default function AiTimelineGenerate({ base, projectId, hasTasks, onApplied, className, label }: {
  base: string;
  projectId: string;
  hasTasks: boolean;
  onApplied: () => void;
  className?: string;
  label?: string;
}) {
  const toast = useToast();
  const { lang } = useLang();
  const t = (id: string, en: string) => (lang === 'id' ? id : en);
  const [open, setOpen] = useState(false);
  const [phases, setPhases] = useState<EPhase[]>([]);
  const [charter, setCharter] = useState<GenerateResponse['charter'] | null>(null);
  const [startDate, setStartDate] = useState(formatDateInput(new Date()));

  const isGuest = useIsGuest();
  const aiQ = useQuery({
    queryKey: ['ai-available', projectId],
    queryFn: () => api.get<{ aiAvailable: boolean }>(`/projects/${projectId}/ai-available`),
    staleTime: 5 * 60_000,
  });

  const generate = useMutation({
    mutationFn: () => api.post<GenerateResponse>(`${base}/ai-generate`, { lang }),
    onSuccess: (res) => {
      setPhases(res.draft.phases.map((p) => ({ ...p, include: true, tasks: p.tasks.map((tk) => ({ ...tk, include: true })) })));
      setCharter(res.charter);
      // Default start: the chartered start for a fresh schedule; today when appending.
      setStartDate(formatDateInput(hasTasks ? new Date() : res.charter.scheduleStart));
      setOpen(true);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('AI tidak dapat menyusun jadwal', 'AI could not compose a schedule')),
  });

  const apply = useMutation({
    mutationFn: () => {
      const payload = {
        startDate,
        phases: phases
          .filter((p) => p.include)
          .map((p) => ({
            name: p.name,
            deliverable: p.deliverable ?? undefined,
            weight: p.weight ?? undefined,
            tasks: p.tasks
              .filter((tk) => tk.include)
              .map((tk) => ({
                name: tk.name,
                durationDays: Math.max(0, Math.round(tk.durationDays || 0)),
                isMilestone: tk.isMilestone === true || (tk.durationDays || 0) === 0,
                deliverable: tk.deliverable ?? undefined,
                acceptanceCriteria: tk.acceptanceCriteria ?? undefined,
                weight: tk.weight ?? undefined,
              })),
          }))
          .filter((p) => p.tasks.length > 0),
      };
      return api.post<{ created: number; phases: number }>(`${base}/apply-ai-draft`, payload);
    },
    onSuccess: (res) => {
      toast.success(t(
        `${res.created} item jadwal dibuat (${res.phases} fase) — sesuaikan lewat WBS.`,
        `${res.created} schedule items created (${res.phases} phases) — refine them in the WBS.`,
      ));
      setOpen(false);
      onApplied();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('Gagal membuat jadwal', 'Failed to create the schedule')),
  });

  // Projected end = start + Σ included durations (sequential calendar days), mirrors the server's
  // deterministic materialiser so the PM sees the same end date before applying.
  const { includedTasks, projectedEnd, overByDays } = useMemo(() => {
    const inc = phases.filter((p) => p.include).flatMap((p) => p.tasks.filter((tk) => tk.include));
    const totalDays = inc.reduce((s, tk) => s + Math.max(0, Math.round(tk.durationDays || 0)), 0);
    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(+start + totalDays * DAY);
    const charterEnd = charter ? new Date(charter.scheduleEnd) : null;
    const over = charterEnd ? Math.round((+end - +charterEnd) / DAY) : 0;
    return { includedTasks: inc.length, projectedEnd: end, overByDays: over };
  }, [phases, startDate, charter]);

  if (!aiQ.data?.aiAvailable) return isGuest ? <GuestAiNote /> : null;

  const patchPhase = (pi: number, patch: Partial<EPhase>) =>
    setPhases((prev) => prev.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
  const patchTask = (pi: number, ti: number, patch: Partial<ETask>) =>
    setPhases((prev) => prev.map((p, i) => (i === pi ? { ...p, tasks: p.tasks.map((tk, j) => (j === ti ? { ...tk, ...patch } : tk)) } : p)));

  const defaultLabel = t('✨ Generate timeline dengan AI', '✨ Generate timeline with AI');
  const triggerClass = className ?? 'inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-100 disabled:opacity-60 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40';

  return (
    <>
      <button type="button" className={triggerClass} disabled={generate.isPending} onClick={() => generate.mutate()}>
        {generate.isPending ? t('Menganalisa…', 'Analyzing…') : (label ?? defaultLabel)}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} title={t('Timeline dari AI', 'AI timeline draft')} size="lg">
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t(
                'Draft disusun dari Scope & Deliverable pada Project Charter. Centang yang ingin dipakai, sesuaikan durasi, lalu Terapkan. Hasil AI bersifat masukan — verifikasi sebelum dipakai.',
                'Drafted from the Scope & Deliverables in the Project Charter. Tick what to keep, tweak durations, then Apply. AI output is advisory — verify before use.',
              )}
            </p>

            {/* Start date + projected-end advisory banner. */}
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="w-44">
                <Field label={t('Tanggal mulai', 'Start date')}>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="text-slate-600 dark:text-slate-300">
                  {t('Perkiraan selesai', 'Projected end')}: <strong>{formatDate(projectedEnd)}</strong>
                  {charter && <> · {t('Akhir charter', 'Charter end')}: {formatDate(new Date(charter.scheduleEnd))}</>}
                </div>
                {charter && (
                  overByDays > 0 ? (
                    <div className="mt-1 text-amber-700 dark:text-amber-400">
                      ⚠ {t(`Melebihi charter ${overByDays} hari — sesuaikan durasi atau tanggal mulai.`, `${overByDays} day${overByDays === 1 ? '' : 's'} past the charter end — adjust durations or the start date.`)}
                    </div>
                  ) : (
                    <div className="mt-1 text-emerald-700 dark:text-emerald-400">
                      ✓ {t('Muat dalam jendela charter.', 'Fits within the charter window.')}
                    </div>
                  )
                )}
                {hasTasks && (
                  <div className="mt-1 text-slate-500 dark:text-slate-400">{t('Ditambahkan ke jadwal yang sudah ada (append).', 'Appended to the existing schedule.')}</div>
                )}
              </div>
            </div>

            {phases.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">{t('Tidak ada usulan jadwal.', 'No schedule suggestions.')}</p>
            ) : (
              <ul className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
                {phases.map((p, pi) => (
                  <li key={pi} className="rounded-lg border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2 border-b border-slate-200/70 bg-slate-50 p-2.5 dark:border-slate-800/70 dark:bg-slate-800/40">
                      <input type="checkbox" className="h-4 w-4 shrink-0" checked={p.include} onChange={(e) => patchPhase(pi, { include: e.target.checked })} />
                      <input
                        value={p.name}
                        onChange={(e) => patchPhase(pi, { name: e.target.value })}
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-slate-800 hover:border-slate-300 focus:border-brand-400 focus:outline-none dark:text-slate-100 dark:hover:border-slate-600"
                      />
                      <Badge color="slate">{t('Fase', 'Phase')}</Badge>
                    </div>
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {p.tasks.map((tk, ti) => {
                        const milestone = tk.isMilestone === true || (tk.durationDays || 0) === 0;
                        return (
                          <li key={ti} className={`flex items-center gap-2 p-2.5 ${p.include && tk.include ? '' : 'opacity-50'}`}>
                            <input type="checkbox" className="h-4 w-4 shrink-0" checked={tk.include} disabled={!p.include} onChange={(e) => patchTask(pi, ti, { include: e.target.checked })} />
                            <input
                              value={tk.name}
                              onChange={(e) => patchTask(pi, ti, { name: e.target.value })}
                              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-700 hover:border-slate-300 focus:border-brand-400 focus:outline-none dark:text-slate-200 dark:hover:border-slate-600"
                            />
                            {tk.deliverable && <span className="hidden max-w-[10rem] truncate text-xs text-slate-400 sm:inline" title={tk.deliverable}>📦 {tk.deliverable}</span>}
                            {milestone ? (
                              <Badge color="indigo">◆ {t('Milestone', 'Milestone')}</Badge>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number" min={0} max={365} value={tk.durationDays}
                                  onChange={(e) => patchTask(pi, ti, { durationDays: e.target.valueAsNumber })}
                                  className="w-16 rounded border border-slate-300 bg-white px-1.5 py-1 text-right text-xs text-slate-700 focus:border-brand-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                />
                                <span className="text-xs text-slate-400">{t('hari', 'days')}</span>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t(`${includedTasks} tugas dipilih`, `${includedTasks} task${includedTasks === 1 ? '' : 's'} selected`)}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>{t('Batal', 'Cancel')}</Button>
                <Button disabled={includedTasks === 0 || apply.isPending} onClick={() => apply.mutate()}>
                  {apply.isPending ? t('Menerapkan…', 'Applying…') : t('Terapkan ke WBS', 'Apply to WBS')}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
