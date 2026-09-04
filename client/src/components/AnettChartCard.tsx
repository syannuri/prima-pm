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

export default function AnettChartCard({ projectId, code, onNavigate }: { projectId: string; code: string; onNavigate?: () => void }) {
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

  return (
    <div className="ml-10 mt-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      {header}
      {isLoading ? (
        <div className="py-3 text-xs text-slate-400">{t.loading}</div>
      ) : isError || !e || e.health === 'NO_DATA' ? (
        <div className="py-2 text-xs text-slate-400">{t.noData}</div>
      ) : (
        <div className="mt-2 space-y-2">
          <HealthBulletGauge spi={e.spi} cpi={e.cpi} hasSchedule={e.pv > 0} hasCost={e.ac > 0} id={lang === 'id'} compact />
          <div className="grid grid-cols-4 gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <Stat label="EV" value={formatIdrShort(e.ev)} />
            <Stat label="AC" value={formatIdrShort(e.ac)} warn={e.ac > e.ev} />
            <Stat label="BAC" value={formatIdrShort(e.bac)} />
            <Stat label={t.complete} value={`${Math.round((e.percentComplete ?? 0) * 100)}%`} />
          </div>
        </div>
      )}
    </div>
  );
}
