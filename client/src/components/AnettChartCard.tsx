import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Evm } from '../api/types';
import HealthBulletGauge from './HealthBulletGauge';
import { formatIdrShort } from '../lib/format';
import { useLang } from '../context/LanguageContext';

// Rich answer card (#2): a compact EVM visual Anett can drop into a chat answer via a [[chart:CODE|evm]]
// marker. Reuses the app's HealthBulletGauge (SPI/CPI) + EVM endpoint, so it stays consistent with the
// project's own Overview. Clickable header deep-links to the project. Degrades to a muted note when the
// project has no EVM baseline yet.

const T = {
  id: { evm: 'EVM', complete: 'Selesai', noData: 'Belum ada data EVM untuk proyek ini.', loading: 'Memuat…' },
  en: { evm: 'EVM', complete: 'Complete', noData: 'No EVM data for this project yet.', loading: 'Loading…' },
};

const HEALTH_DOT: Record<string, string> = {
  GREEN: 'bg-emerald-500', AMBER: 'bg-amber-500', RED: 'bg-rose-500', NO_DATA: 'bg-slate-300 dark:bg-slate-600',
};

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`truncate text-xs font-semibold tabular-nums ${warn ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

export default function AnettChartCard({ projectId, code, onNavigate, v2 }: { projectId: string; code: string; onNavigate?: () => void; v2?: boolean }) {
  const { lang } = useLang();
  const t = T[lang];
  const { data: e, isLoading, isError } = useQuery({
    queryKey: ['evm', projectId, 'anett'],
    queryFn: () => api.get<Evm>(`/projects/${projectId}/evm`),
    staleTime: 60_000,
  });

  const header = (
    <div className="flex items-center justify-between gap-2">
      <Link
        to={`/projects/${projectId}`}
        onClick={onNavigate}
        className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300"
      >
        <span aria-hidden>↗</span>{code} · {t.evm}
      </Link>
      {e && <span className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[e.health] ?? HEALTH_DOT.NO_DATA}`} title={e.health} />}
    </div>
  );

  const body = isLoading ? (
    <div className="py-3 text-xs text-slate-400">{t.loading}</div>
  ) : isError || !e || e.health === 'NO_DATA' ? (
    <div className="py-2 text-xs text-slate-400">{t.noData}</div>
  ) : (
    <div className="space-y-2">
      <HealthBulletGauge spi={e.spi} cpi={e.cpi} hasSchedule={e.pv > 0} hasCost={e.ac > 0} id={lang === 'id'} compact />
      <div className="grid grid-cols-4 gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
        <Stat label="EV" value={formatIdrShort(e.ev)} />
        <Stat label="AC" value={formatIdrShort(e.ac)} warn={e.ac > e.ev} />
        <Stat label="BAC" value={formatIdrShort(e.bac)} />
        <Stat label={t.complete} value={`${Math.round((e.percentComplete ?? 0) * 100)}%`} />
      </div>
    </div>
  );

  // #1 insight card (v2): elevated frame + a per-project violet accent spine + a gradient header band,
  // consistent with the app's card language. Classic keeps the flat bordered card.
  return (
    <div className={`ml-10 mt-2 overflow-hidden rounded-xl border ${v2
      ? 'border-slate-200/80 border-l-[3px] border-l-violet-400 bg-white shadow-sm shadow-slate-900/[0.06] ring-1 ring-black/[0.03] dark:border-slate-700 dark:border-l-violet-500 dark:bg-slate-900 dark:shadow-black/30'
      : 'border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900'}`}>
      <div className={v2 ? 'border-b border-violet-100/70 bg-gradient-to-r from-violet-50/70 to-fuchsia-50/40 px-3 py-2 dark:border-slate-800 dark:from-violet-900/15 dark:to-fuchsia-900/10' : ''}>
        {header}
      </div>
      <div className={v2 ? 'px-3 pb-3 pt-2' : 'mt-2'}>{body}</div>
    </div>
  );
}
