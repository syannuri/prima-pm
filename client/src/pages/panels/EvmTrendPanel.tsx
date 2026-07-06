import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { EvmSnapshot, EvmTrend } from '../../api/types';
import { Button, Card, Input, SectionTitle, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { formatIdr, formatDate, formatDateInput, formatNum } from '../../lib/format';
import EvmTrendChart, { CpiSpiTrend } from '../../components/EvmTrendChart';

type Dir = 'up' | 'down' | 'flat';
const dir = (a: number, b: number): Dir => (Math.abs(b - a) < 0.01 ? 'flat' : b > a ? 'up' : 'down');
const arrow = (d: Dir) => (d === 'up' ? '▲' : d === 'down' ? '▼' : '·');

// EVM Trend: turns the app's point-in-time EVM into a recorded history. progressPct
// is only a "now" value, so Earned Value can't be reconstructed for past dates —
// capturing a status snapshot freezes PV/EV/AC/CPI/SPI so the S-curve and the
// CPI/SPI trend build up over the life of the project (like a CPR/IPMR).
export default function EvmTrendPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canWrite = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['evm-trend', projectId, statusDate],
    queryFn: () => api.get<EvmTrend>(`/projects/${projectId}/evm/trend?statusDate=${statusDate}`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['evm-trend', projectId] });

  const capture = useMutation({
    mutationFn: () => api.post<{ snapshot: EvmSnapshot }>(`/projects/${projectId}/evm/snapshots`, { statusDate, note: note.trim() || undefined }),
    onSuccess: () => { setNote(''); invalidate(); toast.success(`Status captured for ${formatDate(statusDate)}`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Capture failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${projectId}/evm/snapshots/${id}`),
    onSuccess: () => { invalidate(); toast.success('Snapshot deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Delete failed'),
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!data) return <Card>No EVM trend available.</Card>;

  const snaps = data.snapshots;
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle sub="A recorded history of this project's earned value. Capture the status on a date to freeze PV/EV/AC/CPI/SPI — the S-curve and index trend build up over time.">EVM Trend</SectionTitle>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="mr-2 uppercase tracking-wide">Status date</span>
          <Input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} className="!w-auto !py-1.5" />
        </label>
      </div>

      {/* Capture control */}
      {canWrite && (
        <Card className="!p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[200px] text-xs text-slate-500 dark:text-slate-400">
              <span className="mb-1 block uppercase tracking-wide">Note (optional)</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. End of Q1 status review" />
            </label>
            <Button onClick={() => capture.mutate()} disabled={capture.isPending}>📸 Capture status · {formatDate(statusDate)}</Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Captures the EVM computed for the selected status date. Re-capturing the same date updates that snapshot.</p>
        </Card>
      )}

      {/* KPI strip (latest capture) */}
      {latest && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Latest CPI" value={latest.cpi ? formatNum(latest.cpi, 2) : '—'} sub={prev ? `${arrow(dir(prev.cpi, latest.cpi))} vs prev` : 'first capture'} tone={latest.cpi > 0 && latest.cpi < 1 ? 'red' : latest.cpi >= 1 ? 'green' : undefined} />
          <Kpi label="Latest SPI" value={latest.spi ? formatNum(latest.spi, 2) : '—'} sub={prev ? `${arrow(dir(prev.spi, latest.spi))} vs prev` : 'first capture'} tone={latest.spi > 0 && latest.spi < 1 ? 'red' : latest.spi >= 1 ? 'green' : undefined} />
          <Kpi label="% complete" value={`${Math.round(latest.weightedProgress * 100)}%`} sub={`EV ${formatIdr(latest.ev)}`} />
          <Kpi label="Snapshots" value={String(snaps.length)} sub={`as of ${formatDate(latest.statusDate)}`} />
        </div>
      )}

      {snaps.length === 0 ? (
        <Card><p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No status snapshots captured yet.{canWrite ? ' Pick a status date above and press “Capture status” to record the first point of the trend.' : ' Ask the project manager to capture a status.'}</p></Card>
      ) : (
        <>
          <EvmTrendChart data={data} />
          <CpiSpiTrend data={data} />

          {/* Snapshot register */}
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                    <th className="px-3 py-2">Status date</th>
                    <th className="px-3 py-2 text-right">% compl.</th>
                    <th className="px-3 py-2 text-right">PV</th>
                    <th className="px-3 py-2 text-right">EV</th>
                    <th className="px-3 py-2 text-right">AC</th>
                    <th className="px-3 py-2 text-right">CPI</th>
                    <th className="px-3 py-2 text-right">SPI</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {[...snaps].reverse().map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{formatDate(s.statusDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(s.weightedProgress * 100)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{formatIdr(s.pv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{formatIdr(s.ev)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{formatIdr(s.ac)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${s.cpi > 0 && s.cpi < 1 ? 'text-red-600 dark:text-red-400' : s.cpi >= 1 ? 'text-green-600 dark:text-green-400' : ''}`}>{s.cpi ? formatNum(s.cpi, 2) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${s.spi > 0 && s.spi < 1 ? 'text-red-600 dark:text-red-400' : s.spi >= 1 ? 'text-green-600 dark:text-green-400' : ''}`}>{s.spi ? formatNum(s.spi, 2) : '—'}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-xs text-slate-500 dark:text-slate-400" title={s.note ?? undefined}>{s.note ?? <span className="text-slate-300 dark:text-slate-600">—</span>}{s.createdByName && <span className="ml-1 text-slate-300 dark:text-slate-600">· {s.createdByName}</span>}</td>
                      <td className="px-3 py-2 text-right">
                        {canWrite && (
                          <button
                            onClick={async () => { if (await confirm({ title: 'Delete snapshot?', message: <>Delete the status snapshot for <strong>{formatDate(s.statusDate)}</strong>?</>, confirmLabel: 'Delete', danger: true })) del.mutate(s.id); }}
                            className="text-xs text-red-500 hover:underline"
                          >delete</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' }) {
  const c = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-white';
  return (
    <Card className="!p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}
