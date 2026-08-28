import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button, Card, SectionTitle } from './ui';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';

// Portfolio "one thing" digest: deterministic ranking of where attention matters most this week,
// with reason chips + an optional AI "focus this week" narrative. Self-hides when nothing needs
// attention. Read-only; heuristic (not ML).
interface Reason { kind: 'schedule' | 'cost' | 'slip' | 'overdue' | 'dueSoon' | 'risks' | 'crs' | 'resource'; n?: number; detail?: string }
interface AttentionItem { projectId: string; code: string; name: string; score: number; health: string; costHealth: string; reasons: Reason[] }
interface AttentionResponse { generatedAt: string; items: AttentionItem[]; aiAvailable: boolean }
interface Narrative { headline: string; focus: { code: string; why: string }[]; summary: string }

function reasonLabel(r: Reason, id: boolean): string {
  switch (r.kind) {
    case 'schedule': return `${id ? 'Di belakang jadwal' : 'Behind schedule'} · SPI ${r.detail}`;
    case 'cost': return `${id ? 'Over anggaran' : 'Over budget'} · CPI ${r.detail}`;
    case 'slip': return id ? `${r.n} hari terlambat` : `${r.n}d late`;
    case 'overdue': return id ? `${r.n} tugas telat` : `${r.n} overdue`;
    case 'dueSoon': return id ? `${r.n} jatuh tempo ≤14h` : `${r.n} due ≤14d`;
    case 'risks': return id ? `${r.n} risiko tinggi` : `${r.n} high risks`;
    case 'crs': return id ? `${r.n} CR terbuka` : `${r.n} open CRs`;
    case 'resource': return id ? 'Kelebihan beban resource' : 'Resource over-allocated';
    default: return r.kind;
  }
}

const healthDot = (h: string) => (h === 'RED' ? 'bg-red-500' : h === 'AMBER' ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600');

export default function AttentionWidget() {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [narr, setNarr] = useState<Narrative | null>(null);

  const { data } = useQuery({
    queryKey: ['portfolio-attention'],
    queryFn: () => api.get<AttentionResponse>('/portfolio/attention'),
    refetchInterval: 5 * 60_000,
  });
  const aiFocus = useMutation({
    mutationFn: () => api.post<{ items: AttentionItem[]; narrative: Narrative }>('/portfolio/attention/ai-draft', {}),
    onSuccess: (d) => setNarr(d.narrative),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (id ? 'AI tidak dapat menyusun arahan.' : 'AI could not draft the focus.')),
  });

  if (!data || data.items.length === 0) return null; // self-hide when healthy

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <SectionTitle sub={id ? 'Di mana perhatian paling dibutuhkan minggu ini (heuristik, bukan ML).' : 'Where attention matters most this week (heuristic, not ML).'}>
          {id ? 'Perlu perhatian' : 'Needs attention'}
        </SectionTitle>
        {data.aiAvailable && (
          <Button variant="secondary" className="!py-1 text-xs shrink-0" disabled={aiFocus.isPending} onClick={() => aiFocus.mutate()}>
            {aiFocus.isPending ? (id ? 'Menyusun…' : 'Drafting…') : (id ? '✨ Fokus AI' : '✨ AI focus')}
          </Button>
        )}
      </div>

      {narr && (
        <div className="mt-2 rounded-md bg-violet-50 p-3 dark:bg-violet-900/20">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{narr.headline}</p>
          {narr.focus.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {narr.focus.map((f, i) => (
                <li key={i} className="text-xs text-slate-600 dark:text-slate-300"><span className="font-mono text-violet-700 dark:text-violet-300">{f.code}</span> — {f.why}</li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{narr.summary}</p>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {data.items.map((it) => (
          <li key={it.projectId}>
            <Link to={`/projects/${it.projectId}`} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${healthDot(it.health)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-400">{it.code}</span>
                  <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{it.name}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {it.reasons.map((r, i) => (
                    <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{reasonLabel(r, id)}</span>
                  ))}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
