import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Evm } from '../api/types';
import { Badge } from './ui';
import { formatNum } from '../lib/format';

// Compact, always-visible project-health summary for the project header: RAG badge + CPI +
// SPI + % complete, from the methodology-dispatched EVM (/projects/:id/evm). Click to open the
// full Health tab. Mirrors EvmHealth's metric logic so the header and the tab always agree.
export default function ProjectHealthStrip({ projectId, onOpen }: { projectId: string; onOpen?: () => void }) {
  const { data: e } = useQuery({
    queryKey: ['evm', `/projects/${projectId}`, '', 'strip'],
    queryFn: () => api.get<Evm>(`/projects/${projectId}/evm`),
  });
  if (!e) return null;

  const ragColor = e.health === 'GREEN' ? 'green' : e.health === 'AMBER' ? 'amber' : e.health === 'NO_DATA' ? 'slate' : 'red';
  const ragLabel = e.health === 'NO_DATA' ? 'No data' : e.health.charAt(0) + e.health.slice(1).toLowerCase();

  const Metric = ({ label, value, warn, className = '' }: { label: string; value: string; warn?: boolean; className?: string }) => (
    <span className={`flex items-baseline gap-1 whitespace-nowrap ${className}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${warn ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{value}</span>
    </span>
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open Project Health (EVM)"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white/60 px-3 py-1.5 text-left transition hover:border-brand-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/40 dark:hover:border-brand-700 dark:hover:bg-slate-800/60"
    >
      <span className="flex items-center gap-1.5">
        <Badge color={ragColor}>{ragLabel}</Badge>
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">health</span>
      </span>
      {/* CPI & SPI are hidden on phones (they live in the Overview gauge); Health + Complete stay. */}
      <Metric className="hidden sm:flex" label="CPI" value={e.ac > 0 ? formatNum(e.cpi, 2) : '—'} warn={e.ac > 0 && e.cpi < 1} />
      <Metric className="hidden sm:flex" label="SPI" value={e.pv > 0 ? formatNum(e.spi, 2) : '—'} warn={e.pv > 0 && e.spi < 1} />
      <Metric label="Complete" value={`${formatNum(e.scheduleProgress * 100, 0)}%`} />
      <span aria-hidden className="ml-auto hidden text-xs text-brand-600 dark:text-brand-400 sm:inline">Details →</span>
    </button>
  );
}
