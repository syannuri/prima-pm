import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Proposal, ProposalStatus, IntakeWeights, ProjectCategory, DeliveryApproach } from '../api/types';
import { Badge, Button, Card, Field, Input, MoneyInput, Modal, Select, Spinner, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { PROJECT_CATEGORIES, DELIVERY_APPROACH_LABEL, categoryLabel } from '../lib/labels';
import { formatIdrShort, formatDate } from '../lib/format';

// Project Intake & Portfolio Selection — the demand pipeline. Any member submits an idea; ADMIN/PMO
// score (5 weighted criteria), decide (approve/reject/defer), and convert an approved idea into a
// real Project (DRAFT). This is the front of the PMO funnel that precedes a charter.

const STATUS: { value: ProposalStatus; label: string; color: string }[] = [
  { value: 'DRAFT', label: 'Draft', color: 'slate' },
  { value: 'SUBMITTED', label: 'Submitted', color: 'blue' },
  { value: 'UNDER_REVIEW', label: 'Under review', color: 'amber' },
  { value: 'APPROVED', label: 'Approved', color: 'green' },
  { value: 'REJECTED', label: 'Rejected', color: 'red' },
  { value: 'DEFERRED', label: 'Deferred', color: 'violet' },
  { value: 'CONVERTED', label: 'Converted', color: 'brand' },
];
const statusMeta = (s: ProposalStatus) => STATUS.find((x) => x.value === s) ?? STATUS[0];

// Mirror the server: strategic/value/urgency are benefit-type; risk/cost are cost-type (inverted 6−s).
const CRITERIA = [
  { key: 'scoreStrategic', wk: 'strategic', label: 'Strategic fit', cost: false },
  { key: 'scoreValue', wk: 'value', label: 'Business value', cost: false },
  { key: 'scoreRisk', wk: 'risk', label: 'Risk', cost: true },
  { key: 'scoreCost', wk: 'cost', label: 'Cost / effort', cost: true },
  { key: 'scoreUrgency', wk: 'urgency', label: 'Urgency', cost: false },
] as const;
function computeWeighted(p: Partial<Proposal>, w: IntakeWeights): number | null {
  const parts: number[] = [];
  if (p.scoreStrategic != null) parts.push(w.strategic * p.scoreStrategic);
  if (p.scoreValue != null) parts.push(w.value * p.scoreValue);
  if (p.scoreUrgency != null) parts.push(w.urgency * p.scoreUrgency);
  if (p.scoreRisk != null) parts.push(w.risk * (6 - p.scoreRisk));
  if (p.scoreCost != null) parts.push(w.cost * (6 - p.scoreCost));
  if (!parts.length) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export default function PipelinePage() {
  const { user } = useAuth();
  const isPmo = user?.role === 'ADMIN' || user?.role === 'PMO';
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ProposalStatus | 'ALL'>('ALL');
  const [formFor, setFormFor] = useState<Proposal | 'new' | null>(null);
  const [detailFor, setDetailFor] = useState<Proposal | null>(null);
  const [weightsOpen, setWeightsOpen] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['proposals'], queryFn: () => api.get<{ proposals: Proposal[] }>('/intake') });
  const { data: wData } = useQuery({ queryKey: ['intake-weights'], queryFn: () => api.get<{ weights: IntakeWeights }>('/intake/weights') });
  const weights = wData?.weights ?? { strategic: 3, value: 3, risk: 2, cost: 2, urgency: 1 };
  const proposals = (data?.proposals ?? []).filter((p) => filter === 'ALL' || p.status === filter);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['proposals'] });

  // keep any open detail in sync with fresh list data
  const detail = detailFor ? (data?.proposals.find((p) => p.id === detailFor.id) ?? detailFor) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Pipeline</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Capture demand, score it, and convert the winners into projects.</p>
        </div>
        <div className="flex items-center gap-2">
          {isPmo && <Button variant="secondary" onClick={() => setWeightsOpen(true)}>⚖ Scoring weights</Button>}
          <Button onClick={() => setFormFor('new')}>+ New idea</Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {(['ALL', ...STATUS.map((s) => s.value)] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${filter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
            {f === 'ALL' ? 'All' : statusMeta(f).label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : proposals.length === 0 ? (
        <Card><p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No proposals yet — capture the first idea with “+ New idea”.</p></Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <th className="px-4 py-2.5">Code</th><th className="py-2.5">Idea</th><th className="py-2.5">Status</th>
                <th className="py-2.5 text-right">Score</th><th className="py-2.5 text-right">Est. cost</th><th className="py-2.5 text-right">Est. revenue</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} onClick={() => setDetailFor(p)}
                  className="cursor-pointer border-b border-slate-100 transition hover:bg-brand-50/50 dark:border-slate-800 dark:hover:bg-brand-900/15">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</td>
                  <td className="py-2.5">
                    <div className="font-medium text-slate-800 dark:text-slate-100">{p.title}</div>
                    <div className="text-xs text-slate-400">{categoryLabel(p.category, p.categoryOther) ?? '—'}{p.clientName ? ` · ${p.clientName}` : ''}</div>
                  </td>
                  <td className="py-2.5"><Badge color={statusMeta(p.status).color}>{statusMeta(p.status).label}</Badge></td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">{p.weightedScore != null ? Number(p.weightedScore) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                  <td className="py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{p.estCostIdr ? formatIdrShort(p.estCostIdr) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{p.estRevenueIdr ? formatIdrShort(p.estRevenueIdr) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {formFor && <ProposalForm proposal={formFor === 'new' ? null : formFor} onClose={() => setFormFor(null)} onSaved={() => { invalidate(); setFormFor(null); }} />}
      {detail && (
        <ProposalDetail
          p={detail} isPmo={isPmo} uid={user?.id ?? ''} weights={weights}
          onClose={() => setDetailFor(null)}
          onChanged={invalidate}
          onEdit={() => { setFormFor(detail); setDetailFor(null); }}
        />
      )}
      {weightsOpen && <WeightsModal weights={weights} onClose={() => setWeightsOpen(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['intake-weights'] }); invalidate(); setWeightsOpen(false); }} />}
    </div>
  );
}

// ── Create / edit form ──────────────────────────────────────────────────────────────────────────
function ProposalForm({ proposal, onClose, onSaved }: { proposal: Proposal | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: proposal?.title ?? '',
    summary: proposal?.summary ?? '',
    sponsor: proposal?.sponsor ?? '',
    clientName: proposal?.clientName ?? '',
    category: (proposal?.category ?? '') as ProjectCategory | '',
    categoryOther: proposal?.categoryOther ?? '',
    deliveryApproach: (proposal?.deliveryApproach ?? 'PREDICTIVE') as DeliveryApproach,
    estCostIdr: proposal?.estCostIdr ?? '',
    estRevenueIdr: proposal?.estRevenueIdr ?? '',
    targetStart: proposal?.targetStart?.slice(0, 10) ?? '',
    targetFinish: proposal?.targetFinish?.slice(0, 10) ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        title: f.title.trim(), summary: f.summary.trim() || undefined, sponsor: f.sponsor.trim() || undefined,
        clientName: f.clientName.trim() || undefined, category: f.category || undefined,
        categoryOther: f.category === 'OTHER' ? f.categoryOther.trim() : undefined,
        deliveryApproach: f.deliveryApproach,
        estCostIdr: f.estCostIdr === '' ? undefined : Number(f.estCostIdr),
        estRevenueIdr: f.estRevenueIdr === '' ? undefined : Number(f.estRevenueIdr),
        targetStart: f.targetStart || undefined, targetFinish: f.targetFinish || undefined,
      };
      return proposal ? api.put(`/intake/${proposal.id}`, body) : api.post('/intake', body);
    },
    onSuccess: () => { toast.success(proposal ? 'Proposal updated' : 'Idea captured'); onSaved(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to save'),
  });
  return (
    <Modal onClose={onClose} title={proposal ? `Edit ${proposal.code}` : 'New idea'}>
      <div className="space-y-3">
        <Field label="Title" required><Input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Replace the legacy CRM" /></Field>
        <Field label="Summary"><Textarea rows={3} value={f.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="What is this idea, and why now?" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sponsor"><Input value={f.sponsor} onChange={(e) => set({ sponsor: e.target.value })} /></Field>
          <Field label="Client"><Input value={f.clientName} onChange={(e) => set({ clientName: e.target.value })} /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => set({ category: e.target.value as ProjectCategory | '' })}>
              <option value="">— none —</option>
              {PROJECT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Delivery approach">
            <Select value={f.deliveryApproach} onChange={(e) => set({ deliveryApproach: e.target.value as DeliveryApproach })}>
              {(['PREDICTIVE', 'AGILE', 'HYBRID'] as DeliveryApproach[]).map((a) => <option key={a} value={a}>{DELIVERY_APPROACH_LABEL[a]}</option>)}
            </Select>
          </Field>
          {f.category === 'OTHER' && <Field label="Describe the category" required><Input value={f.categoryOther} onChange={(e) => set({ categoryOther: e.target.value })} /></Field>}
          <Field label="Est. cost (IDR)"><MoneyInput value={f.estCostIdr} onValueChange={(v) => set({ estCostIdr: v })} /></Field>
          <Field label="Est. revenue (IDR)"><MoneyInput value={f.estRevenueIdr} onValueChange={(v) => set({ estRevenueIdr: v })} /></Field>
          <Field label="Target start"><Input type="date" value={f.targetStart} onChange={(e) => set({ targetStart: e.target.value })} /></Field>
          <Field label="Target finish"><Input type="date" value={f.targetFinish} onChange={(e) => set({ targetFinish: e.target.value })} /></Field>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={f.title.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Detail: scoring + decision + convert ─────────────────────────────────────────────────────────
function ProposalDetail({ p, isPmo, uid, weights, onClose, onChanged, onEdit }: {
  p: Proposal; isPmo: boolean; uid: string; weights: IntakeWeights; onClose: () => void; onChanged: () => void; onEdit: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [note, setNote] = useState('');
  const isOwner = p.requestedByUserId === uid;
  const canEdit = (isOwner || isPmo) && p.status !== 'CONVERTED';
  const err = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Action failed');

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => onChanged(),
    onError: err,
  });
  const run = (fn: () => Promise<unknown>, ok?: string) => act.mutate(async () => { const r = await fn(); if (ok) toast.success(ok); return r; });

  const liveScore = computeWeighted(p, weights);
  const m = statusMeta(p.status);

  return (
    <Modal onClose={onClose} title={`${p.code} · ${p.title}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={m.color}>{m.label}</Badge>
          {p.weightedScore != null && <span className="text-xs text-slate-500 dark:text-slate-400">Score <b className="text-slate-700 dark:text-slate-200">{Number(p.weightedScore)}</b></span>}
          {p.convertedProjectId && <a href={`/projects/${p.convertedProjectId}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">→ open project</a>}
        </div>
        {p.summary && <p className="text-sm text-slate-600 dark:text-slate-300">{p.summary}</p>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span>Category: <b className="text-slate-700 dark:text-slate-200">{categoryLabel(p.category, p.categoryOther) ?? '—'}</b></span>
          <span>Approach: <b className="text-slate-700 dark:text-slate-200">{DELIVERY_APPROACH_LABEL[p.deliveryApproach]}</b></span>
          <span>Sponsor: <b className="text-slate-700 dark:text-slate-200">{p.sponsor ?? '—'}</b></span>
          <span>Client: <b className="text-slate-700 dark:text-slate-200">{p.clientName ?? '—'}</b></span>
          <span>Est. cost: <b className="text-slate-700 dark:text-slate-200">{p.estCostIdr ? formatIdrShort(p.estCostIdr) : '—'}</b></span>
          <span>Est. revenue: <b className="text-slate-700 dark:text-slate-200">{p.estRevenueIdr ? formatIdrShort(p.estRevenueIdr) : '—'}</b></span>
          {(p.targetStart || p.targetFinish) && <span className="col-span-2">Target: {p.targetStart ? formatDate(p.targetStart) : '—'} → {p.targetFinish ? formatDate(p.targetFinish) : '—'}</span>}
        </div>

        {/* Scoring — PMO edits inline; others see read-only. */}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Scoring (1–5)</span>
            {liveScore != null && <span className="text-sm font-bold text-brand-600 dark:text-brand-400">Weighted total: {liveScore}</span>}
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {CRITERIA.map((c) => (
              <label key={c.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-300">{c.label}{c.cost && <span className="ml-1 text-[10px] text-slate-400">(lower is better)</span>}</span>
                {isPmo ? (
                  <Select value={String((p as never)[c.key] ?? '')} className="!w-20" disabled={p.status === 'CONVERTED' || act.isPending}
                    onChange={(e) => run(() => api.post(`/intake/${p.id}/score`, { [c.key]: e.target.value === '' ? null : Number(e.target.value) }))}>
                    <option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                ) : (
                  <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{(p as never)[c.key] ?? '—'}</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* PMO decision */}
        {isPmo && !['CONVERTED', 'REJECTED'].includes(p.status) && (
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Decision</span>
            <Textarea rows={2} className="mt-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (optional)" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button className="!py-1 text-xs" disabled={act.isPending} onClick={() => run(() => api.post(`/intake/${p.id}/decision`, { decision: 'APPROVE', note: note.trim() || undefined }), 'Approved')}>Approve</Button>
              <Button variant="secondary" className="!py-1 text-xs" disabled={act.isPending} onClick={() => run(() => api.post(`/intake/${p.id}/decision`, { decision: 'DEFER', note: note.trim() || undefined }), 'Deferred')}>Defer</Button>
              <Button variant="secondary" className="!py-1 text-xs !text-red-600 dark:!text-red-400" disabled={act.isPending} onClick={() => run(() => api.post(`/intake/${p.id}/decision`, { decision: 'REJECT', note: note.trim() || undefined }), 'Rejected')}>Reject</Button>
            </div>
          </div>
        )}
        {p.decisionNote && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300"><b>Decision note:</b> {p.decisionNote}</p>}

        {/* Convert (PMO, approved) */}
        {isPmo && p.status === 'APPROVED' && (
          <Button className="w-full" disabled={act.isPending}
            onClick={() => run(async () => { const r = await api.post<{ project: { id: string; code: string } }>(`/intake/${p.id}/convert`, {}); toast.success(`Converted → ${r.project.code}`); return r; })}>
            ✦ Convert to project
          </Button>
        )}

        {/* Owner / PMO actions */}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {canEdit && <Button variant="secondary" className="!py-1 text-xs" onClick={onEdit}>Edit</Button>}
          {(isOwner || isPmo) && ['DRAFT', 'DEFERRED'].includes(p.status) && (
            <Button variant="secondary" className="!py-1 text-xs" disabled={act.isPending} onClick={() => run(() => api.post(`/intake/${p.id}/submit`, {}), 'Submitted for review')}>Submit for review</Button>
          )}
          {isPmo && p.status !== 'CONVERTED' && (
            <Button variant="secondary" className="!py-1 text-xs" disabled={act.isPending} onClick={() => run(() => api.post(`/intake/${p.id}/archive`, { archived: true }), 'Archived')}>Archive</Button>
          )}
          {(isOwner || isPmo) && (
            <Button variant="secondary" className="!ml-auto !py-1 text-xs !text-red-600 dark:!text-red-400" disabled={act.isPending}
              onClick={async () => { if (await confirm({ title: 'Delete proposal?', message: <>Delete <strong>{p.code}</strong>? This cannot be undone.</>, confirmLabel: 'Delete', danger: true })) run(async () => { await api.del(`/intake/${p.id}`); onClose(); }, 'Deleted'); }}>Delete</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Scoring weights (PMO) ────────────────────────────────────────────────────────────────────────
function WeightsModal({ weights, onClose, onSaved }: { weights: IntakeWeights; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [w, setW] = useState<IntakeWeights>(weights);
  const save = useMutation({
    mutationFn: () => api.put('/intake/weights', w),
    onSuccess: () => { toast.success('Weights saved — scores recomputed'); onSaved(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to save'),
  });
  const rows: { k: keyof IntakeWeights; label: string; cost?: boolean }[] = [
    { k: 'strategic', label: 'Strategic fit' }, { k: 'value', label: 'Business value' },
    { k: 'risk', label: 'Risk', cost: true }, { k: 'cost', label: 'Cost / effort', cost: true }, { k: 'urgency', label: 'Urgency' },
  ];
  return (
    <Modal onClose={onClose} title="Scoring weights">
      <div className="space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">Weight each criterion (0–10). Risk &amp; cost are cost-type — a higher raw score counts as worse (inverted in the total).</p>
        {rows.map((r) => (
          <label key={r.k} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-700 dark:text-slate-200">{r.label}{r.cost && <span className="ml-1 text-[10px] text-slate-400">(inverted)</span>}</span>
            <Input type="number" min={0} max={10} step={1} className="!w-24 text-right" value={w[r.k]} onChange={(e) => setW((s) => ({ ...s, [r.k]: Number(e.target.value) }))} />
          </label>
        ))}
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save weights'}</Button>
        </div>
      </div>
    </Modal>
  );
}
