import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { IntakeWeights } from '../api/types';
import { Card, Button, Input, SectionTitle } from './ui';
import { useToast } from './Toast';

// Settings → Governance: per-tenant weights for the intake scoring model (Project Intake &
// Portfolio Selection). Also editable from the Pipeline page's "Scoring weights" shortcut — both
// hit /intake/weights. Risk & cost are cost-type criteria (a higher raw score counts as worse and
// is inverted in the weighted total).
const ROWS: { k: keyof IntakeWeights; label: string; cost?: boolean }[] = [
  { k: 'strategic', label: 'Strategic fit' },
  { k: 'value', label: 'Business value' },
  { k: 'risk', label: 'Risk', cost: true },
  { k: 'cost', label: 'Cost / effort', cost: true },
  { k: 'urgency', label: 'Urgency' },
];

export default function IntakeScoringCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['intake-weights'], queryFn: () => api.get<{ weights: IntakeWeights }>('/intake/weights') });
  const [w, setW] = useState<IntakeWeights | null>(null);
  const eff = w ?? data?.weights ?? { strategic: 3, value: 3, risk: 2, cost: 2, urgency: 1 };
  const save = useMutation({
    mutationFn: () => api.put('/intake/weights', eff),
    onSuccess: () => {
      toast.success('Intake weights saved — scores recomputed');
      qc.invalidateQueries({ queryKey: ['intake-weights'] });
      qc.invalidateQueries({ queryKey: ['proposals'] });
      setW(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to save'),
  });
  return (
    <Card>
      <SectionTitle sub="Weight each criterion (0–10) for scoring intake proposals. Risk & cost are cost-type — a higher raw score counts as worse (inverted in the weighted total).">Intake scoring weights</SectionTitle>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ROWS.map((r) => (
          <label key={r.k} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800">
            <span className="text-slate-700 dark:text-slate-200">{r.label}{r.cost && <span className="ml-1 text-[10px] text-slate-400">(inverted)</span>}</span>
            <Input type="number" min={0} max={10} step={1} className="!w-20 text-right" value={eff[r.k]}
              onChange={(e) => setW({ ...eff, [r.k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button disabled={save.isPending || !w} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save weights'}</Button>
      </div>
    </Card>
  );
}
