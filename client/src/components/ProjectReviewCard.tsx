import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useLang } from '../context/LanguageContext';

// "Review Anett" — surfaces the deterministic project audit (GET /projects/:id/review) on demand, with
// an optional AI narrative (POST .../narrative, gated). Findings deep-link to their tab via onJump.

type Sev = 'HIGH' | 'MEDIUM' | 'LOW';
type Dim = 'SCOPE' | 'SCHEDULE' | 'COST' | 'RISK' | 'GOVERNANCE';
interface Finding { id: string; dimension: Dim; severity: Sev; code: string; title: string; detail: string; count?: number; refs?: { kind: string; id: string }[] }
interface ProjectReview { generatedAt: string; projectCode: string; projectName: string; category: string | null; findings: Finding[]; counts: { high: number; medium: number; low: number; total: number } }
interface Narrative { headline: string; prioritized: { code: string; why: string; recommendation: string }[]; summary: string }

const DIM_TAB: Record<Dim, string> = { SCOPE: 'Requirements', SCHEDULE: 'Schedule', COST: 'Cost', RISK: 'Risk', GOVERNANCE: 'Charter' };
const SEV_DOT: Record<Sev, string> = { HIGH: 'bg-red-500', MEDIUM: 'bg-amber-400', LOW: 'bg-slate-300 dark:bg-slate-600' };
const SEV_CHIP: Record<Sev, string> = {
  HIGH: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300',
  LOW: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
};

const T = {
  id: { title: '🔎 Review Anett', subtitle: 'Audit gap proyek: scope, jadwal, biaya, risiko, tata kelola', ask: 'Minta review Anett', reload: 'Audit ulang', loading: 'Mengaudit…', clean: 'Tidak ada temuan berarti — proyek sehat.', high: 'Tinggi', medium: 'Sedang', low: 'Rendah', open: 'buka', narrate: 'Narasikan (AI)', narrating: 'Menyusun…', aiOff: 'Narasi AI belum aktif untuk workspace ini.', why: 'Dampak', rec: 'Rekomendasi', dims: { SCOPE: 'Lingkup', SCHEDULE: 'Jadwal', COST: 'Biaya', RISK: 'Risiko', GOVERNANCE: 'Tata kelola' } as Record<Dim, string> },
  en: { title: '🔎 Anett Review', subtitle: 'Project gap audit: scope, schedule, cost, risk, governance', ask: 'Request Anett review', reload: 'Re-audit', loading: 'Auditing…', clean: 'No material findings — the project is healthy.', high: 'High', medium: 'Medium', low: 'Low', open: 'open', narrate: 'Narrate (AI)', narrating: 'Composing…', aiOff: 'AI narrative is not enabled for this workspace.', why: 'Impact', rec: 'Recommendation', dims: { SCOPE: 'Scope', SCHEDULE: 'Schedule', COST: 'Cost', RISK: 'Risk', GOVERNANCE: 'Governance' } as Record<Dim, string> },
};

export default function ProjectReviewCard({ projectId, onJump }: { projectId: string; onJump?: (tab: string) => void }) {
  const { lang } = useLang();
  const t = lang === 'en' ? T.en : T.id;
  const [open, setOpen] = useState(false);

  const reviewQ = useQuery({
    queryKey: ['project-review', projectId],
    queryFn: () => api.get<ProjectReview>(`/projects/${projectId}/review`),
    enabled: open,
  });

  const narrateM = useMutation({
    mutationFn: () => api.post<{ review: ProjectReview; narrative: Narrative }>(`/projects/${projectId}/review/narrative`, {}),
  });
  const aiOff = narrateM.error instanceof ApiError && (narrateM.error.status === 503 || narrateM.error.status === 403);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-800 dark:text-slate-100">{t.title}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.subtitle}</div>
        </div>
        <button
          onClick={() => { setOpen(true); if (open) reviewQ.refetch(); }}
          disabled={reviewQ.isFetching}
          className="whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800/60 dark:bg-violet-900/20 dark:text-violet-300"
        >
          {reviewQ.isFetching ? t.loading : open ? t.reload : t.ask}
        </button>
      </div>

      {open && reviewQ.data && (
        <div className="mt-3">
          {/* severity summary */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(['HIGH', 'MEDIUM', 'LOW'] as Sev[]).map((s) => (
              <span key={s} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${SEV_CHIP[s]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${SEV_DOT[s]}`} />
                {s === 'HIGH' ? t.high : s === 'MEDIUM' ? t.medium : t.low}: {reviewQ.data.counts[s.toLowerCase() as 'high' | 'medium' | 'low']}
              </span>
            ))}
          </div>

          {reviewQ.data.findings.length === 0 ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">✓ {t.clean}</div>
          ) : (
            <ul className="space-y-2">
              {reviewQ.data.findings.map((f) => (
                <li key={f.id} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 dark:border-slate-700/60 dark:bg-slate-800/30">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[f.severity]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{f.title}</span>
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">{t.dims[f.dimension]}</span>
                      {f.count != null && <span className="text-xs tabular-nums text-slate-400">×{f.count}</span>}
                      {onJump && (
                        <button onClick={() => onJump(DIM_TAB[f.dimension])} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                          {t.open} →
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{f.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* AI narrative */}
          {reviewQ.data.findings.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => narrateM.mutate()}
                disabled={narrateM.isPending}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {narrateM.isPending ? t.narrating : `🧠 ${t.narrate}`}
              </button>
              {aiOff && <span className="ml-2 text-xs text-slate-400">{t.aiOff}</span>}
              {narrateM.data && (
                <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/50 p-3 text-sm dark:border-violet-900/40 dark:bg-violet-900/10">
                  <div className="font-medium text-slate-800 dark:text-slate-100">{narrateM.data.narrative.headline}</div>
                  <ul className="mt-1.5 space-y-1.5">
                    {narrateM.data.narrative.prioritized.map((p, i) => (
                      <li key={i} className="text-xs text-slate-600 dark:text-slate-300">
                        <span className="font-medium">{t.why}:</span> {p.why} <span className="font-medium">· {t.rec}:</span> {p.recommendation}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 text-xs italic text-slate-500 dark:text-slate-400">{narrateM.data.narrative.summary}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
