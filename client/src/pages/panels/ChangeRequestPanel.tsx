import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Charter, ChangeImpact, ChangeRequest, CharterVersion } from '../../api/types';
import { Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { CHANGE_IMPACTS } from '../../lib/labels';
import { useAuth } from '../../context/AuthContext';

const CR_COLOR: Record<string, string> = { SUBMITTED: 'amber', UNDER_REVIEW: 'amber', APPROVED: 'green', REJECTED: 'red' };

export default function ChangeRequestPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const base = `/projects/${projectId}/charter`;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chargeable, setChargeable] = useState(false);
  const [magnitude, setMagnitude] = useState<'MINOR' | 'MAJOR'>('MINOR');
  const [impactAreas, setImpactAreas] = useState<ChangeImpact[]>([]);
  const [err, setErr] = useState('');

  const charterQ = useQuery({ queryKey: ['charter', projectId], queryFn: () => api.get<{ charter: Charter | null }>(base) });
  const crQ = useQuery({ queryKey: ['charter-crs', projectId], queryFn: () => api.get<{ changeRequests: ChangeRequest[] }>(`${base}/change-requests`) });
  const verQ = useQuery({ queryKey: ['charter-versions', projectId], queryFn: () => api.get<{ versions: CharterVersion[] }>(`${base}/versions`) });

  const refresh = () => {
    ['charter-crs', 'charter-versions', 'charter', 'project'].forEach((k) => qc.invalidateQueries({ queryKey: [k, projectId] }));
  };

  const raise = useMutation({
    mutationFn: () => api.post(`${base}/change-requests`, { title, description, chargeable, magnitude, impactAreas }),
    onSuccess: () => { setTitle(''); setDescription(''); setChargeable(false); setMagnitude('MINOR'); setImpactAreas([]); setErr(''); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) => api.patch(`${base}/change-requests/${id}`, { decision }),
    onSuccess: refresh,
  });

  const toggleImpact = (a: ChangeImpact) => setImpactAreas((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  const isApprover = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const locked = charterQ.data?.charter?.locked ?? false;
  const crs = crQ.data?.changeRequests ?? [];

  if (charterQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <Card>
      <SectionTitle sub="Controlled changes to a committed charter — approval bumps the version and unlocks editing.">
        Change Requests
      </SectionTitle>

      {!locked ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Commit the Project Charter first. Change requests apply to a committed (baselined) charter.
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
              <Select value={chargeable ? 'paid' : 'free'} onChange={(e) => setChargeable(e.target.value === 'paid')}>
                <option value="free">No-cost (unpaid)</option>
                <option value="paid">Chargeable (paid)</option>
              </Select>
            </Field>
          </div>
          <Field label="Reason / description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why the charter must change" />
          </Field>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">Impact areas</span>
            <div className="flex flex-wrap gap-3">
              {CHANGE_IMPACTS.map((a) => (
                <label key={a.value} className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={impactAreas.includes(a.value)} onChange={() => toggleImpact(a.value)} className="accent-brand-600" />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <Button onClick={() => raise.mutate()} disabled={!title || !description || raise.isPending}>
              {raise.isPending ? 'Submitting…' : 'Submit Change Request'}
            </Button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-2 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">Change Requests</div>
          {!crs.length && <p className="text-sm text-slate-400 dark:text-slate-500">No change requests.</p>}
          <div className="space-y-2">
            {crs.map((cr) => (
              <div key={cr.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{cr.title}</span>
                  <Badge color={CR_COLOR[cr.status]}>{cr.status}</Badge>
                  <Badge color={cr.magnitude === 'MAJOR' ? 'red' : 'slate'}>{cr.magnitude}</Badge>
                  <Badge color={cr.chargeable ? 'amber' : 'green'}>{cr.chargeable ? 'Chargeable' : 'No-cost'}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{cr.description}</p>
                {cr.impactAreas?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="text-xs text-slate-400 dark:text-slate-500">Impact:</span>
                    {cr.impactAreas.map((a) => (
                      <span key={a} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{a}</span>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  by {cr.requester?.name ?? '—'} · {formatDate(cr.createdAt)}
                  {cr.decider && ` · decided by ${cr.decider.name}`}
                </p>
                {isApprover && (cr.status === 'SUBMITTED' || cr.status === 'UNDER_REVIEW') && (
                  <div className="mt-2 flex gap-2">
                    <Button onClick={() => decide.mutate({ id: cr.id, decision: 'APPROVED' })} disabled={decide.isPending}>Approve</Button>
                    <Button variant="danger" onClick={() => decide.mutate({ id: cr.id, decision: 'REJECTED' })} disabled={decide.isPending}>Reject</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">Charter Version History</div>
          {!verQ.data?.versions.length && <p className="text-sm text-slate-400 dark:text-slate-500">No committed versions yet.</p>}
          <div className="space-y-1">
            {verQ.data?.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm dark:border-slate-800">
                <span className="font-medium">Version {v.version}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">committed {formatDate(v.committedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
