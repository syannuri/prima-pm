import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Risk, RiskAnalysis } from '../../api/types';
import { Badge, Button, Card, Field, Input, MoneyInput, SectionTitle, Select, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { formatIdr } from '../../lib/format';
import Attachments from '../../components/Attachments';

const SEV_COLOR: Record<string, string> = { LOW: 'green', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red' };

export default function RiskPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [filesFor, setFilesFor] = useState<{ id: string; code: string } | null>(null);
  const base = `/projects/${projectId}/risk`;
  const risksQ = useQuery({ queryKey: ['risks', projectId], queryFn: () => api.get<{ risks: Risk[] }>(base) });
  const analysisQ = useQuery({ queryKey: ['risk-analysis', projectId], queryFn: () => api.get<RiskAnalysis>(`${base}/analysis`) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['risks', projectId] });
    qc.invalidateQueries({ queryKey: ['risk-analysis', projectId] });
    qc.invalidateQueries({ queryKey: ['cost', projectId] });
    qc.invalidateQueries({ queryKey: ['project', projectId] });
  };

  if (risksQ.isLoading) return <Spinner />;
  const a = analysisQ.data;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle sub="Probability × Impact (5×5)">Risk Heatmap</SectionTitle>
          {a && <Heatmap cells={a.heatmap} />}
        </Card>
        <Card>
          <SectionTitle sub="Quantitative — EMV drives the contingency reserve">Reserve &amp; Severity</SectionTitle>
          {a && (
            <div className="space-y-3">
              <div className="rounded-lg bg-brand-50 p-3">
                <div className="text-xs text-brand-600">Contingency Reserve (Σ residual EMV of threats)</div>
                <div className="text-xl font-bold text-brand-700">{formatIdr(a.reserve.contingencyReserve)}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  threat {formatIdr(a.reserve.threatReserve)} · opportunity offset {formatIdr(a.reserve.opportunityOffset)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((s) => (
                  <Badge key={s} color={SEV_COLOR[s]}>{s}: {a.bySeverity[s]}</Badge>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Top risks by EMV</div>
                {a.topByEmv.map((r) => (
                  <div key={r.id} className="flex justify-between border-b border-slate-100 dark:border-slate-800 py-1 text-sm">
                    <span>{r.code} · {r.title}</span>
                    <span className="font-medium">{formatIdr(r.emv)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle sub="Identified risks with qualitative & quantitative analysis">Risk Register</SectionTitle>
        <div className="overflow-x-auto">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2">Code</th><th>Title</th><th>Kind</th><th>P×I</th><th>Severity</th>
                <th className="text-right">EMV</th><th className="text-right">Residual</th><th></th>
              </tr>
            </thead>
            <tbody>
              {risksQ.data?.risks.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{r.code}</td>
                  <td>{r.title}</td>
                  <td><Badge color={r.kind === 'THREAT' ? 'red' : 'green'}>{r.kind}</Badge></td>
                  <td>{r.probabilityScore}×{r.impactScore}={r.riskScore}</td>
                  <td><Badge color={SEV_COLOR[r.severity]}>{r.severity}</Badge></td>
                  <td className="text-right">{formatIdr(r.emv)}</td>
                  <td className="text-right text-slate-500 dark:text-slate-400">{r.residualEmv ? formatIdr(r.residualEmv) : '—'}</td>
                  <td className="text-right">
                    <button
                      onClick={() => setFilesFor((f) => (f?.id === r.id ? null : { id: r.id, code: r.code }))}
                      className="mr-2 text-xs text-brand-600 hover:underline"
                    >
                      📎 files
                    </button>
                    <DeleteRisk base={base} id={r.id} title={r.title} onDone={invalidate} />
                  </td>
                </tr>
              ))}
              {!risksQ.data?.risks.length && <tr><td colSpan={8} className="py-3 text-center text-slate-500 dark:text-slate-400">No risks yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {filesFor && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">Attachments for risk {filesFor.code}</p>
            <Attachments projectId={projectId} ownerType="RISK" ownerId={filesFor.id} />
          </div>
        )}

        <AddRisk base={base} onDone={invalidate} />
      </Card>
    </div>
  );
}

function DeleteRisk({ base, id, title, onDone }: { base: string; id: string; title: string; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`${base}/${id}`),
    onSuccess: () => { onDone(); toast.success('Risk deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete risk'),
  });
  const onClick = async () => {
    if (await confirm({ title: 'Delete risk?', message: <>Delete <strong>{title}</strong>? This recalculates the contingency reserve.</>, confirmLabel: 'Delete', danger: true })) del.mutate();
  };
  return <button onClick={onClick} className="text-xs text-red-500 hover:underline">delete</button>;
}

function Heatmap({ cells }: { cells: RiskAnalysis['heatmap'] }) {
  // probability rows (5 -> 1, top to bottom), impact columns (1 -> 5)
  const color = (score: number) =>
    score <= 5 ? 'bg-green-100' : score <= 12 ? 'bg-amber-100' : score <= 19 ? 'bg-orange-200' : 'bg-red-200';
  const get = (p: number, i: number) => cells.find((c) => c.probability === p && c.impact === i);
  return (
    <div className="inline-block">
      <div className="flex">
        <div className="w-6" />
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="w-12 text-center text-xs text-slate-500 dark:text-slate-400">{i}</div>)}
      </div>
      {[5, 4, 3, 2, 1].map((p) => (
        <div key={p} className="flex items-center">
          <div className="w-6 text-center text-xs text-slate-500 dark:text-slate-400">{p}</div>
          {[1, 2, 3, 4, 5].map((i) => {
            const cell = get(p, i);
            return (
              <div key={i} className={`m-0.5 grid h-11 w-11 place-items-center rounded ${color(p * i)} text-sm font-semibold text-slate-700 dark:text-slate-200`}>
                {cell && cell.count > 0 ? cell.count : ''}
              </div>
            );
          })}
        </div>
      ))}
      <div className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">Impact → / Probability ↑</div>
    </div>
  );
}

function AddRisk({ base, onDone }: { base: string; onDone: () => void }) {
  const [f, setF] = useState({
    title: '', kind: 'THREAT', probabilityScore: '3', impactScore: '3',
    probabilityPct: '0.3', impactCostIdr: '', responseStrategy: '', residualProbabilityPct: '', residualImpactCost: '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const add = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        title: f.title, kind: f.kind,
        probabilityScore: Number(f.probabilityScore), impactScore: Number(f.impactScore),
        probabilityPct: Number(f.probabilityPct), impactCostIdr: Number(f.impactCostIdr),
      };
      if (f.responseStrategy) body.responseStrategy = f.responseStrategy;
      if (f.residualProbabilityPct && f.residualImpactCost) {
        body.residualProbabilityPct = Number(f.residualProbabilityPct);
        body.residualImpactCost = Number(f.residualImpactCost);
      }
      return api.post(`${base}`, body);
    },
    onSuccess: () => { setF((p) => ({ ...p, title: '', impactCostIdr: '', residualProbabilityPct: '', residualImpactCost: '' })); setErr(''); onDone(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  // Live EMV preview: EMV = Probability % × Impact Cost (opportunities count as negative).
  // If a residual (after-mitigation) pair is filled, that's what feeds the reserve.
  const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
  const sign = f.kind === 'OPPORTUNITY' ? -1 : 1;
  const emvPreview = sign * clamp01(Number(f.probabilityPct)) * Math.abs(Number(f.impactCostIdr) || 0);
  const hasResidual = f.residualProbabilityPct !== '' && f.residualImpactCost !== '';
  const residualEmvPreview = hasResidual ? sign * clamp01(Number(f.residualProbabilityPct)) * Math.abs(Number(f.residualImpactCost) || 0) : null;
  const reserveEmv = residualEmvPreview ?? emvPreview;

  return (
    <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
      {/* 2-col on phones: Title/Kind full-width, then the score & cost fields pair up (heatmap, EMV, residual). */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1"><Field label="Title"><Input value={f.title} onChange={(e) => set('title', e.target.value)} /></Field></div>
        <div className="col-span-2 md:col-span-1"><Field label="Kind">
          <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="THREAT">Threat</option><option value="OPPORTUNITY">Opportunity</option>
          </Select>
        </Field></div>
        <Field label="Probability (1-5)" hint="Qualitative — heatmap & severity">
          <Input type="number" min={1} max={5} value={f.probabilityScore} onChange={(e) => set('probabilityScore', e.target.value)} title="Likelihood score 1–5 (qualitative). Sets the risk's row on the 5×5 heatmap and its severity — separate from Probability %." />
        </Field>
        <Field label="Impact (1-5)" hint="Qualitative — heatmap & severity">
          <Input type="number" min={1} max={5} value={f.impactScore} onChange={(e) => set('impactScore', e.target.value)} title="Impact score 1–5 (qualitative). Sets the risk's column on the 5×5 heatmap and its severity." />
        </Field>
        <Field label="Probability % (0-1)" hint="Chance it happens (0.3 = 30%) — drives EMV">
          <Input type="number" step={0.05} min={0} max={1} value={f.probabilityPct} onChange={(e) => set('probabilityPct', e.target.value)} title="Likelihood as a decimal 0–1 (e.g. 0.3 = 30%). Quantitative: EMV = Probability % × Impact Cost, which sets the contingency reserve. Different from the 1–5 score." />
        </Field>
        <Field label="Impact Cost (IDR)" hint="Loss if it happens · EMV = P% × this">
          <MoneyInput value={f.impactCostIdr} onValueChange={(v) => set('impactCostIdr', v)} title="Rupiah loss if the risk occurs. EMV = Probability % × this amount." placeholder="e.g. 100.000.000" />
        </Field>
        <Field label="Residual P% (opt)" hint="Probability after mitigation">
          <Input type="number" step={0.05} min={0} max={1} value={f.residualProbabilityPct} onChange={(e) => set('residualProbabilityPct', e.target.value)} title="Probability remaining AFTER your response/mitigation (0–1). If set with Residual Impact, the residual EMV is what's held in reserve." />
        </Field>
        <Field label="Residual Impact (opt)" hint="Impact cost after mitigation">
          <MoneyInput value={f.residualImpactCost} onValueChange={(v) => set('residualImpactCost', v)} title="Impact cost remaining after mitigation. Residual EMV = Residual P% × this." placeholder="optional" />
        </Field>
      </div>

      {/* Live EMV preview — makes the money impact clear before saving. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900/50">
        <span className="text-slate-500 dark:text-slate-400" title="Expected Monetary Value = Probability % × Impact Cost">
          EMV (auto): <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatIdr(emvPreview)}</span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">= {f.probabilityPct || 0} × {formatIdr(Number(f.impactCostIdr) || 0)}</span>
        {residualEmvPreview != null && (
          <span className="text-slate-500 dark:text-slate-400">· Residual EMV: <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatIdr(residualEmvPreview)}</span></span>
        )}
        <span className="text-xs text-slate-500 dark:text-slate-400">
          → {f.kind === 'OPPORTUNITY' ? 'reduces' : 'adds'} ~{formatIdr(Math.abs(reserveEmv))} {f.kind === 'OPPORTUNITY' ? 'from' : 'to'} the contingency reserve
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button onClick={() => add.mutate()} disabled={!f.title || !f.impactCostIdr || add.isPending}>Add Risk</Button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
