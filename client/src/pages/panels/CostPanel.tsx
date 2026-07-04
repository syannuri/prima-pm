import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { CostSummary, DirectCost, Evm, GanttNode, ResourceItem } from '../../api/types';
import { Button, Card, Input, MoneyInput, SectionTitle, Select, Spinner } from '../../components/ui';
import BaselineLock from '../../components/BaselineLock';
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
    qc.invalidateQueries({ queryKey: ['evm'] }); // Cost-tab EV/AC/CV/CPI strip + Schedule-tab EvmPanel
    qc.invalidateQueries({ queryKey: ['forecast'] }); // Forecast tab (EAC/ETC/VAC)
    qc.invalidateQueries({ queryKey: ['portfolio'] }); // dashboard CPI/AC rollup
  };

  if (isLoading) return <Spinner />;
  const b = data?.baseline;

  return (
    <div className="space-y-5">
      {/* Baseline lock control — freezes cost lines / WBS / schedule baseline (PMB/BAC). */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <BaselineLock projectId={projectId} />
      </div>
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
      <table className="prima-rows w-full text-sm">
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
          {!data.actualCosts.length && <tr><td colSpan={4} className="py-3 text-center text-slate-500 dark:text-slate-400">No actual cost recorded yet.</td></tr>}
        </tbody>
      </table>
      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-4">
        <Input type="date" aria-label="Actual cost date" value={date} onChange={(e) => setDate(e.target.value)} />
        <MoneyInput aria-label="Actual cost amount (IDR)" placeholder="Amount" value={amount} onValueChange={setAmount} />
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
      <div className={`mt-1 ${strong ? 'text-base font-bold text-slate-900 dark:text-white' : 'text-sm font-semibold text-slate-800 dark:text-slate-100'}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-slate-500 dark:text-slate-400">{hint}</div>}
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

  // --- Inline edit of an existing direct-cost line ---
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ type: 'TECHNOLOGY_CLOUD', label: '', qty: '1', unitCost: '', mandays: '', rate: '' });
  const startEdit = (d: DirectCost) => {
    setEditId(d.id);
    setEf({
      type: d.type,
      label: d.label,
      qty: d.qty != null ? String(d.qty) : '1',
      unitCost: d.unitCost != null ? String(Math.trunc(Number(d.unitCost))) : '',
      mandays: d.planMandays != null ? String(d.planMandays) : '',
      rate: d.unitCostPerManday != null ? String(Math.trunc(Number(d.unitCostPerManday))) : '',
    });
  };
  const update = useMutation({
    mutationFn: (d: DirectCost) =>
      api.put(`${base}/direct/${d.id}`, d.type === 'MANPOWER'
        ? {
            type: 'MANPOWER', label: ef.label || d.label, planMandays: Number(ef.mandays),
            taskId: d.taskId ?? undefined, unitCostPerManday: Number(ef.rate),
            ...(d.resourceId ? { resourceId: d.resourceId } : { personnelRole: d.personnelRole }),
          }
        : { type: ef.type, label: ef.label, qty: Number(ef.qty), unitCost: Number(ef.unitCost) }),
    onSuccess: () => { setEditId(null); onChange(); toast.success('Cost line updated'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update cost line'),
  });
  // Live amount for the edit row and the add form (qty×unit or rate×mandays).
  const editRow = data.directCosts.find((d) => d.id === editId);
  const efAmount = !editRow ? 0 : editRow.type === 'MANPOWER'
    ? Number(ef.rate || 0) * Number(ef.mandays || 0)
    : Number(ef.qty || 0) * Number(ef.unitCost || 0);
  const addAmount = isManpower
    ? (rateOverride !== '' ? Number(rateOverride) : Number(picked?.unitCostPerManday ?? 0)) * Number(planMandays || 0)
    : Number(qty || 0) * Number(unitCost || 0);
  // Running total of recorded direct lines (matches the per-row Amount cells) so the
  // projected grand total can be previewed before the new line is submitted.
  const directTotal = data.directCosts.reduce((s, d) => s + Number((d.type === 'MANPOWER' ? d.manpowerCost : d.amount) ?? 0), 0);

  return (
    <Card>
      <SectionTitle sub="Material (qty × unit cost) and Manpower (rate × mandays)">Direct Cost</SectionTitle>
      <div className="overflow-x-auto">
        <table className="prima-rows w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              <th className="py-2">Type</th><th>Item</th><th>Detail</th><th className="text-right">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.directCosts.map((d) => {
              const editing = editId === d.id;
              const isMp = d.type === 'MANPOWER';
              return (
              <tr key={d.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 text-xs text-slate-500 dark:text-slate-400">
                  {editing && !isMp ? (
                    <Select aria-label="Type" value={ef.type} onChange={(e) => setEf((p) => ({ ...p, type: e.target.value }))}>
                      {DIRECT_TYPES.filter((t) => t.value !== 'MANPOWER').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  ) : d.type}
                </td>
                <td>
                  {editing ? (
                    <Input aria-label="Label" value={ef.label} onChange={(e) => setEf((p) => ({ ...p, label: e.target.value }))} placeholder="Label" />
                  ) : (
                    <>
                      <div>{d.label}</div>
                      {isMp && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          <select
                            value={d.resourceId ?? ''}
                            disabled={reassign.isPending}
                            onChange={(e) => reassign.mutate({ d, resourceId: e.target.value })}
                            title="Assign / change resource"
                            aria-label={`Assign resource to ${d.label}`}
                            className={`rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 py-0.5 text-[11px] ${
                              d.resourceId ? 'text-brand-700' : 'text-slate-500 dark:text-slate-400'
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
                              d.taskId ? 'text-brand-700' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            <option value="">📋 No task</option>
                            {leafTasks.map((t) => (
                              <option key={t.id} value={t.id}>📋 {t.wbsCode} {t.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="text-xs text-slate-500 dark:text-slate-400">
                  {!editing ? (
                    isMp
                      ? `${d.personnelRole} · ${formatIdr(d.unitCostPerManday)}/md × ${d.planMandays} md`
                      : `${d.qty} × ${formatIdr(d.unitCost)}`
                  ) : isMp ? (
                    <div className="flex items-center gap-1">
                      <div className="w-28"><MoneyInput aria-label="Rate per manday" value={ef.rate} onValueChange={(v) => setEf((p) => ({ ...p, rate: v }))} /></div>
                      <span className="whitespace-nowrap">/md ×</span>
                      <div className="w-16"><Input type="number" aria-label="Mandays" value={ef.mandays} onChange={(e) => setEf((p) => ({ ...p, mandays: e.target.value }))} /></div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="w-16"><Input type="number" aria-label="Quantity" value={ef.qty} onChange={(e) => setEf((p) => ({ ...p, qty: e.target.value }))} /></div>
                      <span>×</span>
                      <div className="w-28"><MoneyInput aria-label="Unit cost" value={ef.unitCost} onValueChange={(v) => setEf((p) => ({ ...p, unitCost: v }))} /></div>
                    </div>
                  )}
                </td>
                <td className="text-right font-medium tabular-nums">{formatIdr(editing ? efAmount : (isMp ? d.manpowerCost : d.amount))}</td>
                <td className="text-right whitespace-nowrap">
                  {editing ? (
                    <>
                      <button onClick={() => update.mutate(d)} disabled={update.isPending} className="mr-2 text-xs font-medium text-brand-600 hover:underline">save</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(d)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>
                      <button onClick={() => confirmDelete(d)} className="text-xs text-red-500 hover:underline">delete</button>
                    </>
                  )}
                </td>
              </tr>
              );
            })}
            {!data.directCosts.length && <tr><td colSpan={5} className="py-3 text-center text-slate-500 dark:text-slate-400">No direct costs yet.</td></tr>}
          </tbody>
          {data.directCosts.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 text-sm font-semibold dark:border-slate-700">
                <td colSpan={3} className="py-2 text-slate-600 dark:text-slate-300">Total ({data.directCosts.length} {data.directCosts.length === 1 ? 'line' : 'lines'})</td>
                <td className="text-right tabular-nums text-slate-900 dark:text-white">{formatIdr(directTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
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
            <MoneyInput
              aria-label="Rate override (IDR per manday)"
              placeholder={picked ? `${formatIdr(Number(picked.unitCostPerManday))} (rate)` : 'Rate override'}
              value={rateOverride}
              onValueChange={setRateOverride}
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
            <MoneyInput aria-label="Unit cost (IDR)" placeholder="Unit cost" value={unitCost} onValueChange={setUnitCost} />
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
      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
        <span className="text-slate-500 dark:text-slate-400">Amount (auto): <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatIdr(addAmount)}</span></span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="text-slate-500 dark:text-slate-400" title="Recorded direct total + this new line">New Direct total: <span className="font-bold tabular-nums text-slate-900 dark:text-white">{formatIdr(directTotal + addAmount)}</span></span>
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
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ type: 'TRANSPORTATION', description: '', amount: '' });

  const add = useMutation({
    mutationFn: () => api.post(`${base}/indirect`, { type, description, amount: Number(amount) }),
    onSuccess: () => { setDescription(''); setAmount(''); onChange(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add indirect cost'),
  });
  const update = useMutation({
    mutationFn: (id: string) => api.put(`${base}/indirect/${id}`, { type: ef.type, description: ef.description, amount: Number(ef.amount) }),
    onSuccess: () => { setEditId(null); onChange(); toast.success('Indirect cost updated'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update indirect cost'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/indirect/${id}`),
    onSuccess: () => { onChange(); toast.success('Indirect cost deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });
  const confirmDelete = async (i: { id: string; description: string }) => {
    if (await confirm({ title: 'Delete indirect cost?', message: <>Delete <strong>{i.description}</strong>?</>, confirmLabel: 'Delete', danger: true })) del.mutate(i.id);
  };
  const startEdit = (i: { id: string; type: string; description: string; amount: string | number }) => {
    setEditId(i.id);
    setEf({ type: i.type, description: i.description, amount: String(Math.trunc(Number(i.amount))) });
  };
  // Running total of recorded indirect lines, so the projected grand total can be
  // previewed before the new line is submitted.
  const indirectTotal = data.indirectCosts.reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const addAmount = Number(amount || 0);

  return (
    <Card>
      <SectionTitle sub="Transportation, accommodation, entertainment">Indirect Cost</SectionTitle>
      <div className="overflow-x-auto">
        <table className="prima-rows w-full text-sm">
          <tbody>
            {data.indirectCosts.map((i) => {
              const editing = editId === i.id;
              return (
              <tr key={i.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 text-xs text-slate-500 dark:text-slate-400">
                  {editing ? (
                    <Select aria-label="Type" value={ef.type} onChange={(e) => setEf((p) => ({ ...p, type: e.target.value }))}>
                      {INDIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  ) : i.type}
                </td>
                <td>{editing ? <Input aria-label="Description" value={ef.description} onChange={(e) => setEf((p) => ({ ...p, description: e.target.value }))} /> : i.description}</td>
                <td className="text-right font-medium tabular-nums">
                  {editing ? <div className="ml-auto w-32"><MoneyInput aria-label="Amount" value={ef.amount} onValueChange={(v) => setEf((p) => ({ ...p, amount: v }))} /></div> : formatIdr(i.amount)}
                </td>
                <td className="text-right whitespace-nowrap">
                  {editing ? (
                    <>
                      <button onClick={() => update.mutate(i.id)} disabled={update.isPending} className="mr-2 text-xs font-medium text-brand-600 hover:underline">save</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(i)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>
                      <button onClick={() => confirmDelete(i)} className="text-xs text-red-500 hover:underline">delete</button>
                    </>
                  )}
                </td>
              </tr>
              );
            })}
            {!data.indirectCosts.length && <tr><td colSpan={4} className="py-3 text-center text-slate-500 dark:text-slate-400">No indirect costs yet.</td></tr>}
          </tbody>
          {data.indirectCosts.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 text-sm font-semibold dark:border-slate-700">
                <td colSpan={2} className="py-2 text-slate-600 dark:text-slate-300">Total ({data.indirectCosts.length} {data.indirectCosts.length === 1 ? 'line' : 'lines'})</td>
                <td className="text-right tabular-nums text-slate-900 dark:text-white">{formatIdr(indirectTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-4">
        <Select aria-label="Indirect cost type" value={type} onChange={(e) => setType(e.target.value)}>
          {INDIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input aria-label="Indirect cost description" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <MoneyInput aria-label="Indirect cost amount (IDR)" placeholder="Amount" value={amount} onValueChange={setAmount} />
        <Button onClick={() => add.mutate()} disabled={!description || !amount || add.isPending}>Add</Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
        <span className="text-slate-500 dark:text-slate-400">Amount (auto): <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatIdr(addAmount)}</span></span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="text-slate-500 dark:text-slate-400" title="Recorded indirect total + this new line">New Indirect total: <span className="font-bold tabular-nums text-slate-900 dark:text-white">{formatIdr(indirectTotal + addAmount)}</span></span>
      </div>
    </Card>
  );
}
