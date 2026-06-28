import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { CostSummary, DirectCost, User } from '../../api/types';
import { Button, Card, Input, SectionTitle, Select, Spinner } from '../../components/ui';
import { formatIdr } from '../../lib/format';

const DIRECT_TYPES = [
  { value: 'TECHNOLOGY_ONPREM', label: 'Technology — On-Premise' },
  { value: 'TECHNOLOGY_CLOUD', label: 'Technology — Cloud' },
  { value: 'HARDWARE_LICENSE', label: 'Hardware License' },
  { value: 'SOFTWARE_LICENSE', label: 'Software License' },
  { value: 'MANPOWER', label: 'Manpower' },
];
const INDIRECT_TYPES = [
  { value: 'TRANSPORTATION', label: 'Transportation' },
  { value: 'ACCOMMODATION', label: 'Accommodation' },
  { value: 'ENTERTAINMENT', label: 'Entertainment' },
];

export default function CostPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/cost`;
  const { data, isLoading } = useQuery({
    queryKey: ['cost', projectId],
    queryFn: () => api.get<CostSummary>(base),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cost', projectId] });
    qc.invalidateQueries({ queryKey: ['project', projectId] });
  };

  if (isLoading) return <Spinner />;
  const b = data?.baseline;

  return (
    <div className="space-y-5">
      {/* Baseline summary */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Direct" value={formatIdr(b?.directTotal)} />
        <Stat label="Indirect" value={formatIdr(b?.indirectTotal)} />
        <Stat label="Contingency" value={formatIdr(b?.contingencyReserve)} hint="from Risk EMV" />
        <Stat label="Mgmt Reserve" value={formatIdr(b?.managementReserve)} />
        <Stat label="Cost Baseline" value={formatIdr(b?.costBaseline)} />
        <Stat label="BAC" value={formatIdr(b?.budgetAtCompletion)} strong />
      </div>
      {data?.highLevelCharterCost != null && b && (
        <CharterVariance charter={data.highLevelCharterCost} bac={Number(b.budgetAtCompletion)} />
      )}

      <DirectCosts data={data!} base={base} onChange={invalidate} />
      <IndirectCosts data={data!} base={base} onChange={invalidate} />
      <ActualCosts data={data!} base={base} onChange={invalidate} />
    </div>
  );
}

function ActualCosts({ data, base, onChange }: { data: CostSummary; base: string; onChange: () => void }) {
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`${base}/actuals`, { date, amount: Number(amount), description: description || undefined }),
    onSuccess: () => { setAmount(''); setDescription(''); onChange(); },
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`${base}/actuals/${id}`), onSuccess: onChange });

  return (
    <Card>
      <SectionTitle sub="Time-phased spend. Cumulative AC ≤ status date drives the EVM CPI.">
        Actual Cost (AC) — {formatIdr(data.actualCostTotal)} total
      </SectionTitle>
      <table className="w-full text-sm">
        <tbody>
          {data.actualCosts.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{new Date(a.date).toLocaleDateString('en-GB')}</td>
              <td>{a.description ?? '—'}</td>
              <td className="text-right font-medium">{formatIdr(a.amount)}</td>
              <td className="text-right">
                <button onClick={() => del.mutate(a.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </td>
            </tr>
          ))}
          {!data.actualCosts.length && <tr><td colSpan={4} className="py-3 text-center text-slate-400 dark:text-slate-500">No actual cost recorded yet.</td></tr>}
        </tbody>
      </table>
      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-4">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button onClick={() => add.mutate()} disabled={!date || !amount || add.isPending}>Record AC</Button>
      </div>
    </Card>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <Card className="!p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 ${strong ? 'text-base font-bold text-brand-700' : 'text-sm font-semibold text-slate-800 dark:text-slate-100'}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</div>}
    </Card>
  );
}

function CharterVariance({ charter, bac }: { charter: number; bac: number }) {
  const variance = bac - charter;
  const over = variance > 0;
  return (
    <Card className="!p-3">
      <span className="text-sm text-slate-600 dark:text-slate-300">
        Charter estimate {formatIdr(charter)} vs Baseline {formatIdr(bac)} ·{' '}
        <span className={over ? 'font-semibold text-red-600' : 'font-semibold text-green-600'}>
          {over ? 'Over' : 'Under'} by {formatIdr(Math.abs(variance))}
        </span>
      </span>
    </Card>
  );
}

function DirectCosts({ data, base, onChange }: { data: CostSummary; base: string; onChange: () => void }) {
  const [type, setType] = useState('TECHNOLOGY_CLOUD');
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [personnelRole, setPersonnelRole] = useState('PROJECT_PERSONNEL');
  const [unitCostPerManday, setRate] = useState('');
  const [planMandays, setMandays] = useState('');
  const [resourceUserId, setResourceUserId] = useState('');
  const [err, setErr] = useState('');
  const isManpower = type === 'MANPOWER';

  // Named-resource picker for manpower lines (drives cross-project capacity/over-allocation).
  const usersQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory') });

  const add = useMutation({
    mutationFn: () =>
      api.post(`${base}/direct`, isManpower
        ? { type, label, personnelRole, unitCostPerManday: Number(unitCostPerManday), planMandays: Number(planMandays), resourceUserId: resourceUserId || undefined }
        : { type, label, qty: Number(qty), unitCost: Number(unitCost) }),
    onSuccess: () => { setLabel(''); setUnitCost(''); setRate(''); setMandays(''); setResourceUserId(''); setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/direct/${id}`),
    onSuccess: onChange,
  });
  // Inline reassignment: resend the full manpower payload (PUT replaces the line),
  // preserving taskId so the manpower↔schedule link survives the edit.
  const reassign = useMutation({
    mutationFn: ({ d, resourceUserId }: { d: DirectCost; resourceUserId: string }) =>
      api.put(`${base}/direct/${d.id}`, {
        type: 'MANPOWER',
        label: d.label,
        personnelRole: d.personnelRole,
        unitCostPerManday: Number(d.unitCostPerManday),
        planMandays: Number(d.planMandays),
        taskId: d.taskId ?? undefined,
        resourceUserId: resourceUserId || undefined,
      }),
    onSuccess: () => { setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Card>
      <SectionTitle sub="Material (qty × unit cost) and Manpower (rate × mandays)">Direct Cost</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
              <th className="py-2">Type</th><th>Item</th><th>Detail</th><th className="text-right">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.directCosts.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{d.type}</td>
                <td>
                  <div>{d.label}</div>
                  {d.type === 'MANPOWER' && (
                    <select
                      value={d.resourceUserId ?? ''}
                      disabled={reassign.isPending}
                      onChange={(e) => reassign.mutate({ d, resourceUserId: e.target.value })}
                      title="Assign / change resource"
                      className={`mt-0.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 py-0.5 text-[11px] ${
                        d.resourceUserId ? 'text-brand-700' : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      <option value="">👤 Unassigned</option>
                      {usersQ.data?.users.map((u) => (
                        <option key={u.id} value={u.id}>👤 {u.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="text-xs text-slate-500 dark:text-slate-400">
                  {d.type === 'MANPOWER'
                    ? `${d.personnelRole} · ${formatIdr(d.unitCostPerManday)}/md × ${d.planMandays} md`
                    : `${d.qty} × ${formatIdr(d.unitCost)}`}
                </td>
                <td className="text-right font-medium">{formatIdr(d.type === 'MANPOWER' ? d.manpowerCost : d.amount)}</td>
                <td className="text-right">
                  <button onClick={() => del.mutate(d.id)} className="text-xs text-red-500 hover:underline">delete</button>
                </td>
              </tr>
            ))}
            {!data.directCosts.length && <tr><td colSpan={5} className="py-3 text-center text-slate-400 dark:text-slate-500">No direct costs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-7">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {DIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        {isManpower ? (
          <>
            <Select value={personnelRole} onChange={(e) => setPersonnelRole(e.target.value)}>
              <option value="PM">PM</option>
              <option value="PROJECT_PERSONNEL">Project Personnel</option>
            </Select>
            <Input type="number" placeholder="Unit cost/manday" value={unitCostPerManday} onChange={(e) => setRate(e.target.value)} />
            <Input type="number" placeholder="Plan mandays" value={planMandays} onChange={(e) => setMandays(e.target.value)} />
            <Select value={resourceUserId} onChange={(e) => setResourceUserId(e.target.value)} title="Assign a named resource">
              <option value="">Resource… (optional)</option>
              {usersQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </>
        ) : (
          <>
            <Input type="number" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input type="number" placeholder="Unit cost" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            <div />
            <div />
          </>
        )}
        <Button onClick={() => add.mutate()} disabled={!label || add.isPending}>Add</Button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function IndirectCosts({ data, base, onChange }: { data: CostSummary; base: string; onChange: () => void }) {
  const [type, setType] = useState('TRANSPORTATION');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`${base}/indirect`, { type, description, amount: Number(amount) }),
    onSuccess: () => { setDescription(''); setAmount(''); onChange(); },
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`${base}/indirect/${id}`), onSuccess: onChange });

  return (
    <Card>
      <SectionTitle sub="Transportation, accommodation, entertainment">Indirect Cost</SectionTitle>
      <table className="w-full text-sm">
        <tbody>
          {data.indirectCosts.map((i) => (
            <tr key={i.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{i.type}</td>
              <td>{i.description}</td>
              <td className="text-right font-medium">{formatIdr(i.amount)}</td>
              <td className="text-right">
                <button onClick={() => del.mutate(i.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </td>
            </tr>
          ))}
          {!data.indirectCosts.length && <tr><td colSpan={4} className="py-3 text-center text-slate-400 dark:text-slate-500">No indirect costs yet.</td></tr>}
        </tbody>
      </table>
      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-4">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {INDIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button onClick={() => add.mutate()} disabled={!description || !amount || add.isPending}>Add</Button>
      </div>
    </Card>
  );
}
