import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Spinner } from './ui';
import { SettingsGroup } from './settingsUi';
import { useLang } from '../context/LanguageContext';

// AI token & cost dashboard (improvement #1). ADMIN-only card in Settings → Governance. Reads the
// tenant-scoped /ai-usage/summary and shows this workspace's Claude spend (estimated $ + tokens),
// broken down by feature. Dormant-friendly: shows a friendly empty state until AI features run.

interface Bucket {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}
interface Summary {
  window: string;
  totals: Omit<Bucket, 'key'>;
  byFeature: Bucket[];
  byModel: Bucket[];
  budget: { capUsd: number; usedUsd: number; remainingUsd: number } | null;
}

const FEATURE_LABEL: Record<'id' | 'en', Record<string, string>> = {
  id: {
    assistant_qa: 'Asisten Anett', narrative: 'Narasi status', cr_impact: 'Analisis dampak CR',
    evm_explain: 'Penjelasan EVM', risk_suggest: 'Saran risiko', portfolio_qa: 'Tanya portofolio',
    proactive: 'Sapuan proaktif', data_extract: 'Ekstraksi data', resource_realloc: 'Realokasi resource',
    schedule_suggest: 'Draf jadwal AI', whatif: 'Skenario what-if', unknown: 'Lainnya',
  },
  en: {
    assistant_qa: 'Anett assistant', narrative: 'Status narrative', cr_impact: 'CR impact analysis',
    evm_explain: 'EVM explainer', risk_suggest: 'Risk suggestions', portfolio_qa: 'Portfolio Q&A',
    proactive: 'Proactive sweep', data_extract: 'Data extract', resource_realloc: 'Resource realloc',
    schedule_suggest: 'AI schedule draft', whatif: 'What-if scenarios', unknown: 'Other',
  },
};

const T = {
  id: {
    title: 'Penggunaan & biaya AI', sub: 'Workspace-wide — token & estimasi biaya panggilan Claude. Angka biaya adalah PERKIRAAN dari harga per-token, bukan tagihan.',
    month: 'Bulan ini', d30: '30 hari', estCost: 'Estimasi biaya', calls: 'panggilan', tokens: 'token',
    inTok: 'Input', outTok: 'Output', cache: 'Cache', feature: 'Fitur', empty: 'Belum ada penggunaan AI pada periode ini. Angka akan terisi otomatis saat fitur AI dipakai.',
    estimate: 'Estimasi — bukan tagihan resmi.', budget: 'Anggaran AI bulan ini', ofCap: 'dari',
  },
  en: {
    title: 'AI usage & cost', sub: 'Workspace-wide — tokens & estimated cost of Claude calls. The cost figure is an ESTIMATE from per-token pricing, not a bill.',
    month: 'This month', d30: '30 days', estCost: 'Estimated cost', calls: 'calls', tokens: 'tokens',
    inTok: 'Input', outTok: 'Output', cache: 'Cache', feature: 'Feature', empty: 'No AI usage in this window yet. Figures fill in automatically as AI features are used.',
    estimate: 'Estimate — not an official bill.', budget: 'AI budget this month', ofCap: 'of',
  },
};

const fmtInt = (n: number) => n.toLocaleString();
const fmtUsd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

export default function AiUsageCard() {
  const { lang } = useLang();
  const t = T[lang];
  const [window, setWindow] = useState<'month' | '30d'>('month');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-usage', window],
    queryFn: () => api.get<Summary>(`/ai-usage/summary?window=${window}`),
  });

  const totals = data?.totals;
  const cacheTok = (totals?.cacheCreationTokens ?? 0) + (totals?.cacheReadTokens ?? 0);

  return (
    <SettingsGroup
      title={t.title}
      sub={t.sub}
      action={
        <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-slate-300 text-xs dark:border-slate-600">
          {(['month', '30d'] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-2.5 py-1 ${window === w ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300'}`}
            >
              {w === 'month' ? t.month : t.d30}
            </button>
          ))}
        </div>
      }
    >

      {data?.budget && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{t.budget}</span>
            <span className="tabular-nums">{fmtUsd(data.budget.usedUsd)} {t.ofCap} {fmtUsd(data.budget.capUsd)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            {(() => {
              const pct = data.budget.capUsd > 0 ? Math.min(100, (data.budget.usedUsd / data.budget.capUsd) * 100) : 0;
              const tone = pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-violet-600';
              return <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />;
            })()}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-6"><Spinner /></div>
      ) : !totals || totals.calls === 0 ? (
        <p className="py-4 text-sm text-slate-500 dark:text-slate-400">{t.empty}</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-900/20">
              <div className="text-2xl font-semibold text-violet-700 dark:text-violet-300">{fmtUsd(totals.estimatedCostUsd)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.estCost}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <div className="text-2xl font-semibold text-slate-700 dark:text-slate-200">{fmtInt(totals.calls)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.calls}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmtInt(totals.inputTokens)} / {fmtInt(totals.outputTokens)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.inTok} / {t.outTok} {t.tokens}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmtInt(cacheTok)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.cache} {t.tokens}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.feature}</th>
                  <th className="px-3 py-2 text-right font-medium">{t.calls}</th>
                  <th className="px-3 py-2 text-right font-medium">{t.tokens}</th>
                  <th className="px-3 py-2 text-right font-medium">{t.estCost}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data!.byFeature.map((b) => (
                  <tr key={b.key}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{FEATURE_LABEL[lang][b.key] ?? b.key}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtInt(b.calls)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtInt(b.inputTokens + b.outputTokens + b.cacheCreationTokens + b.cacheReadTokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-700 dark:text-slate-200">{fmtUsd(b.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t.estimate}</p>
        </div>
      )}
    </SettingsGroup>
  );
}
