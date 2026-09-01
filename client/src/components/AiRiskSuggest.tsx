import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Badge, Button, Modal } from './ui';
import { useToast } from './Toast';
import GuestAiNote, { useIsGuest } from './GuestAiNote';
import { useLang } from '../context/LanguageContext';

// Advisory AI risk suggestions from the charter + WBS. Shape mirrors the server's RiskSuggestSchema.
interface RiskSuggestion {
  title: string;
  description: string;
  category: string;
  kind: 'THREAT' | 'OPPORTUNITY';
  probabilityScore: number;
  impactScore: number;
  responseStrategy?: string | null;
}

// Map a 1–5 qualitative probability score to a starting EMV probability. impactCostIdr defaults to 0
// on accept — the PM refines the money figure via the existing inline edit. (The server derives
// severity/riskScore/emv from these.)
const PCT_BY_SCORE: Record<number, number> = { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 };
const SEV_COLOR = (rs: number) => (rs >= 15 ? 'red' : rs >= 8 ? 'amber' : 'green');
const cap = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

export default function AiRiskSuggest({ base, projectId, existingTitles, onDone }: {
  base: string; projectId: string; existingTitles: string[]; onDone: () => void;
}) {
  const toast = useToast();
  const { lang } = useLang();
  const t = (id: string, en: string) => (lang === 'id' ? id : en);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RiskSuggestion[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const isGuest = useIsGuest();
  const aiQ = useQuery({
    queryKey: ['ai-available', projectId],
    queryFn: () => api.get<{ aiAvailable: boolean }>(`/projects/${projectId}/ai-available`),
    staleTime: 5 * 60_000,
  });

  const suggest = useMutation({
    mutationFn: () => api.post<{ risks: RiskSuggestion[] }>(`${base}/ai-suggest`, { lang }),
    onSuccess: (res) => {
      // Pre-tick suggestions that aren't near-duplicates of an existing risk title.
      const existing = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
      const next = new Set<number>();
      res.risks.forEach((r, i) => { if (!existing.has(r.title.trim().toLowerCase())) next.add(i); });
      setItems(res.risks);
      setChecked(next);
      setOpen(true);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('AI tidak dapat menyusun saran risiko', 'AI could not compose risk suggestions')),
  });

  const add = useMutation({
    // Sequential creates: the server derives each risk code from the current count, so concurrent
    // POSTs could collide on the code.
    mutationFn: async (chosen: RiskSuggestion[]) => {
      for (const r of chosen) {
        const body: Record<string, unknown> = {
          title: r.title, description: r.description, category: r.category,
          kind: r.kind, status: 'IDENTIFIED',
          probabilityScore: r.probabilityScore, impactScore: r.impactScore,
          probabilityPct: PCT_BY_SCORE[r.probabilityScore] ?? 0.5, impactCostIdr: 0,
        };
        if (r.responseStrategy) body.responseStrategy = r.responseStrategy;
        await api.post(base, body);
      }
    },
    onSuccess: (_d, chosen) => {
      toast.success(t(
        `${chosen.length} risiko ditambahkan sebagai draft — lengkapi EMV via Edit.`,
        `${chosen.length} risk${chosen.length === 1 ? '' : 's'} added as draft — complete the EMV via Edit.`,
      ));
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('Gagal menambah risiko', 'Failed to add risk')),
  });

  if (!aiQ.data?.aiAvailable) return isGuest ? <GuestAiNote /> : null;

  const toggle = (i: number) => setChecked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const chosen = items.filter((_, i) => checked.has(i));

  return (
    <>
      <Button variant="secondary" className="!py-1 text-xs" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
        {suggest.isPending ? t('Menganalisa…', 'Analyzing…') : t('✨ Sarankan risiko dengan AI', '✨ Suggest risks with AI')}
      </Button>

      {open && (
        <Modal onClose={() => setOpen(false)} title={t('Saran risiko (AI)', 'Risk suggestions (AI)')} size="lg">
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t(
                'Centang risiko yang ingin ditambahkan. Setiap risiko dibuat sebagai draft (status Identified); lengkapi nilai EMV lewat Edit. Hasil AI bersifat masukan — verifikasi sebelum dipakai.',
                'Tick the risks you want to add. Each is created as a draft (status Identified); complete the EMV value via Edit. AI output is advisory — verify before use.',
              )}
            </p>
            {items.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">{t('Tidak ada saran risiko.', 'No risk suggestions.')}</p>
            ) : (
              <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {items.map((r, i) => {
                  const rs = r.probabilityScore * r.impactScore;
                  const dup = existingTitles.some((t) => t.trim().toLowerCase() === r.title.trim().toLowerCase());
                  return (
                    <li key={i}>
                      <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked.has(i)} onChange={() => toggle(i)} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.title}</span>
                            <Badge color={r.kind === 'OPPORTUNITY' ? 'green' : 'slate'}>{r.kind === 'OPPORTUNITY' ? 'Opportunity' : 'Threat'}</Badge>
                            <Badge color={SEV_COLOR(rs)}>P{r.probabilityScore}×I{r.impactScore} = {rs}</Badge>
                            {r.responseStrategy && <Badge color="indigo">{cap(r.responseStrategy)}</Badge>}
                            {dup && <Badge color="amber">{t('Mirip yang ada', 'Similar exists')}</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{r.category} · {r.description}</p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
              <Button variant="secondary" onClick={() => setOpen(false)}>{t('Batal', 'Cancel')}</Button>
              <Button disabled={chosen.length === 0 || add.isPending} onClick={() => add.mutate(chosen)}>
                {add.isPending ? t('Menambah…', 'Adding…') : t(`Tambah terpilih (${chosen.length})`, `Add selected (${chosen.length})`)}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
