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
  // Dependency + resource hints — preserved through review so the server can build the FS network
  // and level resources (dropping them would collapse every timeline into a serial chain).
  ref?: string;
  deps?: string[];
  resourceRole?: string | null;
  resourceRef?: string | null;
}
interface DraftPhase {
  name: string;
  deliverable?: string | null;
  weight?: number | null;
  tasks: DraftTask[];
}
interface PoolResource { ref: string; label: string; capacityPerDay: number }
interface GenerateResponse {
  draft: { phases: DraftPhase[] };
  charter: { scheduleStart: string; scheduleEnd: string; scheduleWorkingDaysBudget: number };
  resources: PoolResource[];
}

// Editable copies carry an `include` flag so the PM can drop phases / tasks before applying.
type ETask = DraftTask & { include: boolean };
type EPhase = Omit<DraftPhase, 'tasks'> & { include: boolean; tasks: ETask[] };

const DAY = 86_400_000;

export default function AiTimelineGenerate({ base, projectId, hasTasks, onApplied, className, label, container }: {
  base: string;
  projectId: string;
  hasTasks: boolean;
  onApplied: () => void;
  className?: string;
  label?: string;
  container?: Element | null;
}) {
  const toast = useToast();
  const { lang } = useLang();
  const t = (id: string, en: string) => (lang === 'id' ? id : en);
  const [open, setOpen] = useState(false);
  const [phases, setPhases] = useState<EPhase[]>([]);
  const [charter, setCharter] = useState<GenerateResponse['charter'] | null>(null);
  const [resources, setResources] = useState<PoolResource[]>([]);
  const [startDate, setStartDate] = useState(formatDateInput(new Date()));
  const [link, setLink] = useState(true); // create FS links + auto-schedule (weekend-aware)
  const [fit, setFit] = useState(false); // scale durations to land on the charter end (opt-in)
  const [level, setLevel] = useState(true); // resource-level: serialise same-resource overlaps
  const [assign, setAssign] = useState(true); // set task owner from a matched register resource

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
      setResources(res.resources ?? []);
      // Default start: the chartered start for a fresh schedule; today when appending.
      setStartDate(formatDateInput(hasTasks ? new Date() : res.charter.scheduleStart));
      setOpen(true);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('AI tidak dapat menyusun jadwal', 'AI could not compose a schedule')),
  });

  const apply = useMutation({
    mutationFn: () => {
      // Only carry deps whose target task is still included, so dropping a task can't dangle a link.
      const keptRefs = new Set(phases.filter((p) => p.include).flatMap((p) => p.tasks.filter((tk) => tk.include && tk.ref).map((tk) => tk.ref!)));
      const payload = {
        startDate,
        link,
        fit,
        level,
        assign,
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
                // Round-trip the FS network + resource hints so parallelism / leveling survive review.
                ref: tk.ref,
                deps: tk.deps?.filter((d) => keptRefs.has(d)),
                resourceRole: tk.resourceRole ?? undefined,
                resourceRef: tk.resourceRef ?? undefined,
              })),
          }))
          .filter((p) => p.tasks.length > 0),
      };
      return api.post<{ created: number; phases: number; links: number; levelingLinks: number; assigned: number }>(`${base}/apply-ai-draft`, payload);
    },
    onSuccess: (res) => {
      const links = res.links > 0
        ? t(` + ${res.links} keterkaitan (auto-schedule)`, ` + ${res.links} link${res.links === 1 ? '' : 's'} (auto-scheduled)`)
        : '';
      const lvl = res.levelingLinks > 0 ? t(`, ${res.levelingLinks} leveling`, `, ${res.levelingLinks} leveling`) : '';
      const own = res.assigned > 0 ? t(`, ${res.assigned} pemilik`, `, ${res.assigned} owner${res.assigned === 1 ? '' : 's'}`) : '';
      toast.success(t(
        `${res.created} item jadwal dibuat (${res.phases} fase)${links}${lvl}${own} — sesuaikan lewat WBS.`,
        `${res.created} schedule items created (${res.phases} phases)${links}${lvl}${own} — refine them in the WBS.`,
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
    const charterEnd = charter ? new Date(charter.scheduleEnd) : null;
    // With fit on, the server scales durations so the timeline lands on the charter end.
    const canFit = fit && charterEnd && totalDays > 0 && +charterEnd > +start;
    const end = canFit ? charterEnd : new Date(+start + totalDays * DAY);
    const over = charterEnd ? Math.round((+end - +charterEnd) / DAY) : 0;
    return { includedTasks: inc.length, projectedEnd: end, overByDays: over };
  }, [phases, startDate, charter, fit]);

  const resLabelByRef = useMemo(() => new Map(resources.map((r) => [r.ref, r.label])), [resources]);
  const taskResourceLabel = (tk: ETask): string | null =>
    (tk.resourceRef && resLabelByRef.get(tk.resourceRef)) || tk.resourceRole || null;

  // Advisory per-resource load (pre-leveling): early-start each included ref-mapped task over the FS
  // deps, then peak concurrency per resource. peak > capacity ⇒ over-allocated (leveling will serialise
  // it on apply). Mirrors the server's list-scheduling intent; role-only tasks count as unassigned here.
  const resourceLoad = useMemo(() => {
    const byRef = new Map(resources.map((r) => [r.ref, r]));
    const inc = phases.filter((p) => p.include).flatMap((p) => p.tasks.filter((tk) => tk.include));
    const keptRefs = new Set(inc.filter((t) => t.ref).map((t) => t.ref!));
    const dur = (t: ETask) => (t.isMilestone === true || (t.durationDays || 0) <= 0 ? 0 : Math.max(0, Math.round(t.durationDays || 0)));
    const byRefTask = new Map(inc.filter((t) => t.ref).map((t) => [t.ref!, t]));
    const early = new Map<string, number>();
    const visiting = new Set<string>();
    const es = (ref: string): number => {
      if (early.has(ref)) return early.get(ref)!;
      if (visiting.has(ref)) return 0; // cycle guard
      visiting.add(ref);
      let v = 0;
      for (const d of byRefTask.get(ref)?.deps ?? []) if (keptRefs.has(d)) v = Math.max(v, es(d) + dur(byRefTask.get(d)!));
      visiting.delete(ref);
      early.set(ref, v);
      return v;
    };
    const perRes = new Map<string, { start: number; end: number }[]>();
    let unassigned = 0;
    for (const t of inc) {
      if (dur(t) === 0) continue;
      const ref = t.resourceRef && byRef.has(t.resourceRef) ? t.resourceRef : null;
      if (!ref) { unassigned++; continue; }
      const s = t.ref ? es(t.ref) : 0;
      (perRes.get(ref) ?? perRes.set(ref, []).get(ref)!).push({ start: s, end: s + dur(t) });
    }
    const rows = resources.map((r) => {
      const iv = perRes.get(r.ref) ?? [];
      const pts = iv.flatMap((x) => [{ x: x.start, d: 1 }, { x: x.end, d: -1 }]).sort((a, b) => a.x - b.x || a.d - b.d);
      let cur = 0, peak = 0;
      for (const p of pts) { cur += p.d; peak = Math.max(peak, cur); }
      return { ref: r.ref, label: r.label, capacity: r.capacityPerDay, count: iv.length, peak, over: peak > r.capacityPerDay };
    }).filter((row) => row.count > 0);
    return { rows, unassigned, anyOver: rows.some((row) => row.over) };
  }, [phases, resources]);

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
        <Modal onClose={() => setOpen(false)} title={t('Timeline dari AI', 'AI timeline draft')} size="lg" container={container}>
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

            {/* Link tasks (FS) + auto-schedule. When on, the projected end above is a rough estimate —
                real dates snap to working days (weekends skipped). */}
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={link} onChange={(e) => setLink(e.target.checked)} />
              <span>
                <span className="font-medium text-slate-700 dark:text-slate-200">🔗 {t('Kaitkan tugas (FS) & auto-schedule', 'Link tasks (FS) & auto-schedule')}</span>
                <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
                  {t(
                    'Buat ketergantungan finish-to-start lalu jadwalkan pada hari kerja — edit durasi akan menggeser jadwal downstream otomatis.',
                    'Create finish-to-start links then schedule on working days — editing a duration then cascades to downstream tasks.',
                  )}
                </span>
              </span>
            </label>

            {/* Hard-fit: scale durations so the timeline lands on the charter end. Opt-in (distorts the
                AI's estimates). Exact when linking is off; with auto-schedule, working days may extend it. */}
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={fit} onChange={(e) => setFit(e.target.checked)} />
              <span>
                <span className="font-medium text-slate-700 dark:text-slate-200">📐 {t('Paskan ke jendela charter (skala durasi)', 'Fit to charter window (scale durations)')}</span>
                <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
                  {t(
                    'Durasi diskalakan proporsional agar mendarat di akhir charter. Eksak saat penjadwalan mati; dengan auto-schedule, hari kerja bisa sedikit memperpanjang.',
                    'Durations are scaled proportionally to land on the charter end. Exact when linking is off; with auto-schedule, working days may extend it slightly.',
                  )}
                </span>
              </span>
            </label>

            {/* Resource-aware options. Leveling needs the FS network, so it's tied to `link`. */}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800 ${link ? '' : 'opacity-50'}`}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={level && link} disabled={!link} onChange={(e) => setLevel(e.target.checked)} />
                <span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">⚖️ {t('Ratakan resource (leveling)', 'Level resources')}</span>
                  <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
                    {t('Tugas dengan resource sama yang bertabrakan diserialkan; resource berbeda tetap paralel.', 'Same-resource tasks that clash are serialised; different resources stay parallel.')}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={assign} onChange={(e) => setAssign(e.target.checked)} />
                <span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">👤 {t('Tetapkan pemilik (owner)', 'Assign owners')}</span>
                  <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
                    {t('Isi pemilik tugas dari resource register yang cocok (role tanpa padanan dibiarkan kosong).', "Set the task owner from a matched register resource (unmatched roles are left blank).")}
                  </span>
                </span>
              </label>
            </div>

            {/* Advisory resource-load summary: peak concurrent demand vs capacity per resource. */}
            {resourceLoad.rows.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('Beban resource', 'Resource load')}</span>
                  {resourceLoad.anyOver && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">
                      {level && link
                        ? t('⚖️ Akan diratakan saat diterapkan', '⚖️ Will be levelled on apply')
                        : t('⚠ Aktifkan leveling untuk meratakan', '⚠ Enable leveling to resolve')}
                    </span>
                  )}
                </div>
                <ul className="space-y-1">
                  {resourceLoad.rows.map((r) => (
                    <li key={r.ref} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300" title={r.label}>{r.label}</span>
                      <span className="tabular-nums text-slate-400">{t(`${r.count} tugas`, `${r.count} task${r.count === 1 ? '' : 's'}`)}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${r.over ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                        {t('puncak', 'peak')} {r.peak}/{r.capacity}
                      </span>
                    </li>
                  ))}
                </ul>
                {resourceLoad.unassigned > 0 && (
                  <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    {t(`${resourceLoad.unassigned} tugas tanpa resource spesifik`, `${resourceLoad.unassigned} task${resourceLoad.unassigned === 1 ? '' : 's'} with no specific resource`)}
                  </p>
                )}
              </div>
            )}

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
                            {tk.deliverable && <span className="hidden max-w-[9rem] truncate text-xs text-slate-400 sm:inline" title={tk.deliverable}>📦 {tk.deliverable}</span>}
                            {taskResourceLabel(tk) && (
                              <span className="hidden max-w-[9rem] shrink-0 truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 sm:inline dark:bg-slate-800 dark:text-slate-400" title={taskResourceLabel(tk)!}>
                                👤 {taskResourceLabel(tk)}
                              </span>
                            )}
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
