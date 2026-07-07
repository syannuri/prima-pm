import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Charter, ChangeImpact, ChangeRequest, CharterVersion } from '../../api/types';
import { Badge, Button, Card, Field, Input, MoneyInput, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { formatDate, formatIdr } from '../../lib/format';
import { CHANGE_IMPACTS } from '../../lib/labels';
import CrDetailModal from '../../components/CrDetailModal';

const CR_COLOR: Record<string, string> = { SUBMITTED: 'amber', UNDER_REVIEW: 'sky', APPROVED: 'green', REJECTED: 'red' };
const FILTERS = ['ALL', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
const label = (s: string) => s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function ChangeRequestPanel({ projectId, projectCode, projectName }: { projectId: string; projectCode: string; projectName: string }) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/charter`;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chargeable, setChargeable] = useState(false);
  const [amount, setAmount] = useState('');
  const [magnitude, setMagnitude] = useState<'MINOR' | 'MAJOR'>('MINOR');
  const [impactAreas, setImpactAreas] = useState<ChangeImpact[]>([]);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [detail, setDetail] = useState<ChangeRequest | null>(null);

  const charterQ = useQuery({ queryKey: ['charter', projectId], queryFn: () => api.get<{ charter: Charter | null }>(base) });
  const crQ = useQuery({ queryKey: ['charter-crs', projectId], queryFn: () => api.get<{ changeRequests: ChangeRequest[] }>(`${base}/change-requests`) });
  const verQ = useQuery({ queryKey: ['charter-versions', projectId], queryFn: () => api.get<{ versions: CharterVersion[] }>(`${base}/versions`) });

  const refresh = () => {
    ['charter-crs', 'charter-versions', 'charter', 'project'].forEach((k) => qc.invalidateQueries({ queryKey: [k, projectId] }));
  };

  const raise = useMutation({
    mutationFn: () => api.post(`${base}/change-requests`, { title, description, chargeable, amountIdr: chargeable ? Number(amount) : undefined, magnitude, impactAreas }),
    onSuccess: () => { setTitle(''); setDescription(''); setChargeable(false); setAmount(''); setMagnitude('MINOR'); setImpactAreas([]); setErr(''); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  const toggleImpact = (a: ChangeImpact) => setImpactAreas((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  const locked = charterQ.data?.charter?.locked ?? false;
  const crs = crQ.data?.changeRequests ?? [];
  const filtered = filter === 'ALL' ? crs : crs.filter((c) => c.status === filter);

  if (charterQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <Card>
      <SectionTitle sub="Controlled changes to the baselined project — its charter, cost baseline or schedule/WBS. Approval opens the affected area for editing (charter re-commit, or baseline unlock); apply the change, then re-lock.">
        Change Requests &amp; Log
      </SectionTitle>

      {!locked ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Commit the Project Charter first — change requests become available once the project is baselined.
        </p>
      ) : (
        <div className="mb-5 grid gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800 md:grid-cols-2">
          <Field label="Change title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Increase budget for extra scope" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Magnitude">
              <Select value={magnitude} onChange={(e) => setMagnitude(e.target.value as 'MINOR' | 'MAJOR')}>
                <option value="MINOR">Minor</option>
                <option value="MAJOR">Major</option>
              </Select>
            </Field>
            <Field label="Chargeable">
              <Select value={chargeable ? 'paid' : 'free'} onChange={(e) => { const paid = e.target.value === 'paid'; setChargeable(paid); if (!paid) setAmount(''); }}>
                <option value="free">No-cost (unpaid)</option>
                <option value="paid">Chargeable (paid)</option>
              </Select>
            </Field>
          </div>
          <Field label="Reason / description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this change is needed and what it changes" />
          </Field>
          {/* Amount only shown for a chargeable (paid) change */}
          {chargeable && (
            <Field label="Amount (IDR)" hint="Billable amount for this chargeable change.">
              <MoneyInput value={amount} onValueChange={setAmount} placeholder="e.g. 50.000.000" />
            </Field>
          )}
          <div className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">What does this change affect? <span className="text-red-500">*</span></span>
            <div className="flex flex-col gap-1.5">
              {CHANGE_IMPACTS.map((a) => (
                <label key={a.value} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={impactAreas.includes(a.value)} onChange={() => toggleImpact(a.value)} className="accent-brand-600" />
                  {a.label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Approving this change unlocks the selected area(s) so you can edit them — apply the change, then re-lock the baseline.</p>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <Button onClick={() => raise.mutate()} disabled={!title || !description || impactAreas.length === 0 || (chargeable && !amount) || raise.isPending}>
              {raise.isPending ? 'Submitting…' : 'Submit Change Request'}
            </Button>
            {impactAreas.length === 0 && <span className="text-xs text-slate-400 dark:text-slate-500">Select at least one affected area.</span>}
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Change Log</span>
            {FILTERS.map((f) => {
              const n = f === 'ALL' ? crs.length : crs.filter((c) => c.status === f).length;
              return (
                <button key={f} onClick={() => setFilter(f)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${filter === f ? 'border-brand-500 bg-brand-600/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 text-slate-500 hover:border-brand-300 dark:border-slate-700 dark:text-slate-400'}`}>
                  {f === 'ALL' ? 'All' : label(f)} <span className="text-slate-500 dark:text-slate-400">{n}</span>
                </button>
              );
            })}
          </div>
          {!filtered.length ? (
            <p className="py-4 text-sm text-slate-500 dark:text-slate-400">No change requests{filter !== 'ALL' ? ` with status ${label(filter)}` : ''}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="prima-rows w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2">Change request</th><th>Status</th><th>Requested</th><th>Reviewed</th><th>Decided</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((cr) => (
                    <tr key={cr.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-slate-700 dark:text-slate-200">{cr.title}</span>
                          <Badge color={cr.magnitude === 'MAJOR' ? 'red' : 'slate'}>{cr.magnitude}</Badge>
                          {cr.chargeable
                            ? <Badge color="amber">{cr.amountIdr != null ? formatIdr(cr.amountIdr) : 'Chargeable'}</Badge>
                            : <Badge color="green">No-cost</Badge>}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">by {cr.requester?.name ?? '—'}</div>
                      </td>
                      <td className="py-2"><Badge color={CR_COLOR[cr.status] ?? 'slate'}>{label(cr.status)}</Badge></td>
                      <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(cr.createdAt)}</td>
                      <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{cr.reviewedAt ? `${formatDate(cr.reviewedAt)}${cr.reviewer ? ` · ${cr.reviewer.name}` : ''}` : '—'}</td>
                      <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{cr.decidedAt ? `${formatDate(cr.decidedAt)}${cr.decider ? ` · ${cr.decider.name}` : ''}` : '—'}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => setDetail(cr)} className="text-xs font-medium text-brand-600 hover:underline">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Charter Version History</div>
          {!verQ.data?.versions.length && <p className="text-sm text-slate-500 dark:text-slate-400">No committed versions yet.</p>}
          <div className="space-y-1">
            {verQ.data?.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm dark:border-slate-800">
                <span className="font-medium">Version {v.version}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">committed {formatDate(v.committedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {detail && <CrDetailModal cr={{ ...detail, project: { id: projectId, code: projectCode, name: projectName } }} onClose={() => setDetail(null)} />}
    </Card>
  );
}
