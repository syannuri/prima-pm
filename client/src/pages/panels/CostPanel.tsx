import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { CostSummary, DirectCost, Evm, GanttNode, ResourceItem } from '../../api/types';
import { Button, Card, Input, SectionTitle, Select, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { formatDateInput, formatIdr, formatNum } from '../../lib/format';

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

// Flatten a gantt tree to its leaf tasks (work packages manpower is assigned to).
function flattenLeaves(nodes: GanttNode[]): GanttNode[] {
  return nodes.flatMap((n) => (n.children?.length ? flattenLeaves(n.children) : [n]));
}

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
        <Stat label="BAC (PMB)" value={formatIdr(b?.costBaseline)} hint="Budget at Completion = direct + indirect + contingency (excl. mgmt reserve)" strong />
        <Stat label="Total Budget" value={formatIdr(b?.budgetAtCompletion)} hint="BAC + management reserve" />
      </div>
      {data?.highLevelCharterCost != null && b && (
        <CharterVariance charter={data.highLevelCharterCost} bac={Number(b.costBaseline)} />
      )}

      <DirectCosts data={data!} base={base} onChange={invalidate} />
      <IndirectCosts data={data!} base={base} onChange={invalidate} />
      <ActualCosts data={data!} base={base} onChange={invalidate} />
    </div>
  );
}

function ActualCosts({ data, base, onChange }: { data: CostSummary; base: string; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  // Pull EV/AC/CPI so the user can see how Actual Cost relates to Earned Value.
  const scheduleBase = base.replace(/\/cost$/, '/schedule');
  const evmQ = useQuery({ queryKey: ['evm', scheduleBase, '', formatDateInput(new Date())], queryFn: () => api.get<Evm>(`${scheduleBase}/evm?statusDate=${formatDateInput(new Date())}`) });
  const e = evmQ.data;

  const add = useMutation({
    mutationFn: () => api.post(`${base}/actuals`, { date, amount: Number(amount), description: description || undefined }),
    onSuccess: () => { setAmount(''); setDescription(''); onChange(); toast.success('Actual cost recorded'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to record actual cost'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/actuals/${id}`),
    onSuccess: () => { onChange(); toast.success('Actual cost entry deleted'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to delete entry'),
  });
  const confirmDelete = async (id: string) => {
    if (await confirm({ title: 'Delete actual cost entry?', message: 'This removes the recorded spend and recalculates CPI.', confirmLabel: 'Delete', danger: true })) del.mutate(id);
  };

  return (
    <Card>
      <SectionTitle sub="Real money spent — recorded here manually. It is NOT taken from % progress (that drives Earned Value). CPI = EV ÷ AC.">
        Actual Cost (AC) — {formatIdr(data.actualCostTotal)} total
      </SectionTitle>

      {/* How AC relates to progress / Earned Value, so AC = 0 isn't mistaken for a bug. */}
      {e && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 text-xs text-slate-600 dark:text-slate-300">
          <span title="Earned Value = % progress × budget (automatic)">Earned (EV): <span className="font-semibold text-slate-800 dark:text-slate-100">{formatIdr(e.ev)}</span></span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span title="Actual Cost = money actually spent (recorded below)">Spent (AC): <span className="font-semibold text-slate-800 dark:text-slate-100">{formatIdr(e.ac)}</span></span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span title="Cost Variance = EV − AC">CV: <span className={`font-semibold ${e.ac > 0 && e.cv < 0 ? 'text-red-600 dark:text-red-400' : e.ac > 0 ? 'text-green-600 dark:text-green-400' : ''}`}>{e.ac > 0 ? formatIdr(e.cv) : '—'}</span></span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span title="Cost Performance Index = EV ÷ AC">CPI: <span className="font-semibold text-slate-800 dark:text-slate-100">{e.ac > 0 ? formatNum(e.cpi, 2) : '—'}</span></span>
          {e.ac === 0 && e.ev > 0 && (
            <span className="text-amber-600 dark:text-amber-400">↳ You’ve earned {formatIdr(e.ev)} of work but recorded Rp 0 spent — add actual spend below to get CPI.</span>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <tbody>
          {data.actualCosts.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{new Date(a.date).toLocaleDateString('en-GB')}</td>
              <td>{a.description ?? '—'}</td>
              <td className="text-right font-medium">{formatIdr(a.amount)}</td>
              <td className="text-right">
                <button onClick={() => confirmDelete(a.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </td>
            </tr>
          ))}
          {!data.actualCosts.length && <tr><td colSpan={4} className="py-3 text-center text-slate-400 dark:text-slate-500">No actual cost recorded yet.</td></tr>}
        </tbody>
      </table>
      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-4">
        <Input type="date" aria-label="Actual cost date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input type="number" aria-label="Actual cost amount (IDR)" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input aria-label="Actual cost description" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
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
  const toast = useToast();
  const confirm = useConfirm();
  const [type, setType] = useState('TECHNOLOGY_CLOUD');
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [planMandays, setMandays] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [rateOverride, setRateOverride] = useState('');
  const [taskId, setTaskId] = useState('');
  const [err, setErr] = useState('');
  const isManpower = type === 'MANPOWER';

  // Manpower is loaded from the resource master pool (rate & role come from it).
  const resourcesQ = useQuery({ queryKey: ['resources'], queryFn: () => api.get<{ resources: ResourceItem[] }>('/resources') });
  const picked = resourcesQ.data?.resources.find((r) => r.id === resourceId);

  // Leaf tasks for the manpower↔schedule link (assign work to a work package).
  const scheduleBase = base.replace(/\/cost$/, '/schedule');
  const ganttQ = useQuery({ queryKey: ['gantt', scheduleBase], queryFn: () => api.get<{ tree: GanttNode[] }>(`${scheduleBase}/gantt`) });
  const leafTasks = flattenLeaves(ganttQ.data?.tree ?? []);

  const add = useMutation({
    mutationFn: () =>
      api.post(`${base}/direct`, isManpower
        ? { type, label: label || picked?.name || '', resourceId, planMandays: Number(planMandays), unitCostPerManday: rateOverride === '' ? undefined : Number(rateOverride), taskId: taskId || undefined }
        : { type, label, qty: Number(qty), unitCost: Number(unitCost) }),
    onSuccess: () => { setLabel(''); setUnitCost(''); setMandays(''); setResourceId(''); setRateOverride(''); setTaskId(''); setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/direct/${id}`),
    onSuccess: () => { onChange(); toast.success('Cost line deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete cost line'),
  });
  const confirmDelete = async (d: DirectCost) => {
    if (await confirm({ title: 'Delete cost line?', message: <>Delete <strong>{d.label}</strong> from direct costs? This recalculates the cost baseline.</>, confirmLabel: 'Delete', danger: true })) del.mutate(d.id);
  };
  // Inline reassignment: resend the manpower line pointing at a new resource. Rate &
  // role are re-derived server-side from that resource; taskId preserved so the
  // manpower↔schedule link survives the edit.
  const reassign = useMutation({
    mutationFn: ({ d, resourceId }: { d: DirectCost; resourceId: string }) =>
      api.put(`${base}/direct/${d.id}`, {
        type: 'MANPOWER',
        label: d.label,
        planMandays: Number(d.planMandays),
        taskId: d.taskId ?? undefined,
        resourceId: resourceId || undefined,
        // No resource → keep the existing rate/role so the line stays valid.
        ...(resourceId ? {} : { personnelRole: d.personnelRole, unitCostPerManday: Number(d.unitCostPerManday) }),
      }),
    onSuccess: () => { setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  // Inline task (re)assignment: change only the linked work package; rate, role &
  // resource are sent back explicitly so nothing else on the line changes.
  const reassignTask = useMutation({
    mutationFn: ({ d, taskId }: { d: DirectCost; taskId: string }) =>
      api.put(`${base}/direct/${d.id}`, {
        type: 'MANPOWER',
        label: d.label,
        planMandays: Number(d.planMandays),
        taskId: taskId || undefined,
        resourceId: d.resourceId ?? undefined,
        personnelRole: d.personnelRole,
        unitCostPerManday: Number(d.unitCostPerManday),
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
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <select
                        value={d.resourceId ?? ''}
                        disabled={reassign.isPending}
                        onChange={(e) => reassign.mutate({ d, resourceId: e.target.value })}
                        title="Assign / change resource"
                        aria-label={`Assign resource to ${d.label}`}
                        className={`rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 py-0.5 text-[11px] ${
                          d.resourceId ? 'text-brand-700' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        <option value="">👤 Unassigned</option>
                        {resourcesQ.data?.resources.map((r) => (
                          <option key={r.id} value={r.id}>👤 {r.name}</option>
                        ))}
                      </select>
                      <select
                        value={d.taskId ?? ''}
                        disabled={reassignTask.isPending}
                        onChange={(e) => reassignTask.mutate({ d, taskId: e.target.value })}
                        title="Link / change task (work package)"
                        aria-label={`Link ${d.label} to a task`}
                        className={`rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 py-0.5 text-[11px] ${
                          d.taskId ? 'text-brand-700' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        <option value="">📋 No task</option>
                        {leafTasks.map((t) => (
                          <option key={t.id} value={t.id}>📋 {t.wbsCode} {t.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </td>
                <td className="text-xs text-slate-500 dark:text-slate-400">
                  {d.type === 'MANPOWER'
                    ? `${d.personnelRole} · ${formatIdr(d.unitCostPerManday)}/md × ${d.planMandays} md`
                    : `${d.qty} × ${formatIdr(d.unitCost)}`}
                </td>
                <td className="text-right font-medium">{formatIdr(d.type === 'MANPOWER' ? d.manpowerCost : d.amount)}</td>
                <td className="text-right">
                  <button onClick={() => confirmDelete(d)} className="text-xs text-red-500 hover:underline">delete</button>
                </td>
              </tr>
            ))}
            {!data.directCosts.length && <tr><td colSpan={5} className="py-3 text-center text-slate-400 dark:text-slate-500">No direct costs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-7">
        <Select aria-label="Direct cost type" value={type} onChange={(e) => setType(e.target.value)}>
          {DIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input aria-label="Cost line label" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        {isManpower ? (
          <>
            <Select aria-label="Pick resource from pool" value={resourceId} onChange={(e) => setResourceId(e.target.value)} title="Pick from the resource pool">
              <option value="">Resource…</option>
              {resourcesQ.data?.resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name} · {formatIdr(Number(r.unitCostPerManday))}/md</option>
              ))}
            </Select>
            <Input
              type="number"
              aria-label="Rate override (IDR per manday)"
              placeholder={picked ? `${formatIdr(Number(picked.unitCostPerManday))} (rate)` : 'Rate override'}
              value={rateOverride}
              onChange={(e) => setRateOverride(e.target.value)}
              title="Leave blank to use the resource's rate"
            />
            <Input
              type="number"
              aria-label="Planned mandays"
              placeholder="Plan mandays"
              value={planMandays}
              onChange={(e) => setMandays(e.target.value)}
              title={picked && planMandays ? `= ${formatIdr((rateOverride === '' ? Number(picked.unitCostPerManday) : Number(rateOverride)) * Number(planMandays))}` : 'rate × mandays'}
            />
            <Select aria-label="Link to a task" value={taskId} onChange={(e) => setTaskId(e.target.value)} title="Link to a task (work package)">
              <option value="">Task… (optional)</option>
              {leafTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.wbsCode} {t.name}</option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <Input type="number" aria-label="Quantity" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input type="number" aria-label="Unit cost (IDR)" placeholder="Unit cost" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            <div />
            <div />
          </>
        )}
        <Button
          onClick={() => add.mutate()}
          disabled={add.isPending || (isManpower ? !resourceId || !planMandays : !label)}
          title={isManpower ? (!resourceId ? 'Pick a Resource from the pool first' : !planMandays ? 'Enter Plan mandays' : 'Add manpower line') : !label ? 'Enter a label first' : 'Add cost line'}
        >
          Add
        </Button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function IndirectCosts({ data, base, onChange }: { data: CostSummary; base: string; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [type, setType] = useState('TRANSPORTATION');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`${base}/indirect`, { type, description, amount: Number(amount) }),
    onSuccess: () => { setDescription(''); setAmount(''); onChange(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add indirect cost'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/indirect/${id}`),
    onSuccess: () => { onChange(); toast.success('Indirect cost deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });
  const confirmDelete = async (i: { id: string; description: string }) => {
    if (await confirm({ title: 'Delete indirect cost?', message: <>Delete <strong>{i.description}</strong>?</>, confirmLabel: 'Delete', danger: true })) del.mutate(i.id);
  };

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
                <button onClick={() => confirmDelete(i)} className="text-xs text-red-500 hover:underline">delete</button>
              </td>
            </tr>
          ))}
          {!data.indirectCosts.length && <tr><td colSpan={4} className="py-3 text-center text-slate-400 dark:text-slate-500">No indirect costs yet.</td></tr>}
        </tbody>
      </table>
      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-4">
        <Select aria-label="Indirect cost type" value={type} onChange={(e) => setType(e.target.value)}>
          {INDIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input aria-label="Indirect cost description" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input type="number" aria-label="Indirect cost amount (IDR)" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button onClick={() => add.mutate()} disabled={!description || !amount || add.isPending}>Add</Button>
      </div>
    </Card>
  );
}
