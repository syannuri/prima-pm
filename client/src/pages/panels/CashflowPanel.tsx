import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Cashflow, CashflowGranularity } from '../../api/types';
import { Button, Card, PanelLoading } from '../../components/ui';
import InfoTip from '../../components/InfoTip';
import CashflowChart from '../../components/CashflowChart';
import { useLang } from '../../context/LanguageContext';
import { formatIdr, formatDateInput } from '../../lib/format';
import { toCsv, downloadCsv } from '../../lib/csv';

function Stat({ label, value, hint, strong, valueClass }: { label: string; value: string; hint?: string; strong?: boolean; valueClass?: string }) {
  return (
    <Card className="!p-3">
      <div className="flex items-center text-xs text-slate-500 dark:text-slate-400">{label}{hint && <InfoTip text={hint} />}</div>
      <div className={`mt-1 ${strong ? 'text-base font-bold' : 'text-sm font-semibold'} ${valueClass ?? (strong ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-100')}`}>{value}</div>
    </Card>
  );
}

export default function CashflowPanel({ projectId }: { projectId: string }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [gran, setGran] = useState<CashflowGranularity>('month');
  const today = formatDateInput(new Date());

  const GRANS: { key: CashflowGranularity; label: string }[] = [
    { key: 'week', label: id ? 'Minggu' : 'Week' },
    { key: 'month', label: id ? 'Bulan' : 'Month' },
    { key: 'quarter', label: id ? 'Kuartal' : 'Quarter' },
  ];

  const { data, isLoading } = useQuery({
    queryKey: ['cashflow', projectId, gran, today],
    queryFn: () => api.get<Cashflow>(`/projects/${projectId}/cashflow?granularity=${gran}&statusDate=${today}`),
  });

  if (isLoading) return <PanelLoading />;
  if (!data) return <Card>{id ? 'Arus kas tidak tersedia.' : 'Cash-flow unavailable.'}</Card>;

  const exportCsv = () => {
    const csv = toCsv(
      id
        ? ['Periode', 'Rencana', 'Aktual', 'Proyeksi', 'Committed', 'Σ Rencana', 'Σ Aktual', 'Σ Proyeksi']
        : ['Period', 'Planned', 'Actual', 'Forecast', 'Committed', 'Cum. planned', 'Cum. actual', 'Cum. forecast'],
      data.periods.map((p) => [p.label, p.planned, p.actual ?? '', p.forecast ?? '', p.committed, p.cumPlanned, p.cumActual ?? '', p.cumForecast ?? '']),
    );
    downloadCsv(`cashflow-${gran}-${today}.csv`, csv);
  };

  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {id ? 'Arus kas / anggaran per periode' : 'Cash-flow / time-phased budget'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {id
              ? 'Rencana pengeluaran (BCWS), realisasi (AC), proyeksi kebutuhan kas, dan komitmen (PO) yang dibagi per periode kalender.'
              : 'Planned spend (BCWS), actuals (AC), forecast cash need, and committed cost (POs) broken down by calendar period.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {GRANS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGran(g.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${gran === g.key ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-700 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`}
              >{g.label}</button>
            ))}
          </div>
          <Button variant="secondary" onClick={exportCsv} disabled={!data.hasData}>{id ? 'Export CSV' : 'Export CSV'}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="BAC" value={formatIdr(s.bac)} hint={id ? 'Budget at Completion — total anggaran dasar.' : 'Budget at Completion — the total baseline budget.'} strong />
        <Stat label={id ? 'Terpakai s/d kini' : 'Spent to date'} value={formatIdr(s.acToDate)} hint={id ? 'Actual Cost kumulatif hingga tanggal status.' : 'Cumulative Actual Cost up to the status date.'} />
        <Stat label="EAC (likely)" value={formatIdr(s.eacLikely)} hint={id ? 'Estimate at Completion — perkiraan biaya akhir.' : 'Estimate at Completion — projected final cost.'} />
        <Stat label={id ? 'Sisa kebutuhan' : 'Remaining need'} value={formatIdr(s.remaining)} hint={id ? 'EAC likely − AC: kas yang masih perlu dikeluarkan.' : 'EAC likely − AC: cash still to be spent.'} strong valueClass="text-brand-600 dark:text-brand-300" />
        <Stat label={id ? 'Committed (PO)' : 'Committed (PO)'} value={formatIdr(s.totalCommitted)} hint={id ? 'Kontrak/PO terikat (awarded→delivered). Obligasi, belum tentu terbayar.' : 'Obligated contracts/POs (awarded→delivered). Committed, not necessarily paid.'} />
      </div>

      {data.hasData ? (
        <>
          <Card>
            <CashflowChart periods={data.periods} eacLikely={s.eacLikely} />
          </Card>

          <Card className="overflow-x-auto !p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">{id ? 'Periode' : 'Period'}</th>
                  <th className="px-3 py-2 text-right font-medium">{id ? 'Rencana' : 'Planned'}</th>
                  <th className="px-3 py-2 text-right font-medium">{id ? 'Aktual' : 'Actual'}</th>
                  <th className="px-3 py-2 text-right font-medium">{id ? 'Proyeksi' : 'Forecast'}</th>
                  <th className="px-3 py-2 text-right font-medium">Committed</th>
                  <th className="px-3 py-2 text-right font-medium">{id ? 'Σ Rencana' : 'Σ Planned'}</th>
                  <th className="px-3 py-2 text-right font-medium">{id ? 'Σ Aktual' : 'Σ Actual'}</th>
                </tr>
              </thead>
              <tbody>
                {data.periods.map((p, i) => (
                  <tr key={p.key} className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${i % 2 ? 'bg-slate-50/50 dark:bg-slate-800/30' : ''}`}>
                    <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200">{p.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatIdr(p.planned)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-sky-600 dark:text-sky-400">{p.actual != null ? formatIdr(p.actual) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-brand-600 dark:text-brand-300">{p.forecast != null ? formatIdr(p.forecast) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber-600 dark:text-amber-400">{p.committed ? formatIdr(p.committed) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{formatIdr(p.cumPlanned)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{p.cumActual != null ? formatIdr(p.cumActual) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <Card className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          {id
            ? 'Belum ada jadwal (WBS) atau tanggal charter untuk membagi anggaran per periode. Susun jadwal atau isi tanggal charter terlebih dulu.'
            : 'No schedule (WBS) or charter dates yet to time-phase the budget. Build the schedule or set the charter dates first.'}
        </Card>
      )}
    </div>
  );
}
