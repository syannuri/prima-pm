import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project, ProjectCategory } from '../api/types';
import { Button, Field, Input, Select } from './ui';
import { PROJECT_CATEGORIES } from '../lib/labels';
import { formatIdr } from '../lib/format';
import { useAuth } from '../context/AuthContext';

// Edit a project's high-level details. Backend enforces write access (owning PM,
// or any ADMIN/PMO); we also gate the trigger by role.
export default function EditProjectModal({ project }: { project: Project }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName ?? '');
  const [sponsor, setSponsor] = useState(project.sponsor ?? '');
  const [category, setCategory] = useState<ProjectCategory | ''>(project.category ?? '');
  const [costBaseline, setCostBaseline] = useState(project.costBaselineIdr ?? '');
  const [revenue, setRevenue] = useState(project.totalRevenueIdr ?? '');
  const [err, setErr] = useState('');

  const canEdit = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);

  const start = () => {
    setName(project.name);
    setClientName(project.clientName ?? '');
    setSponsor(project.sponsor ?? '');
    setCategory(project.category ?? '');
    setCostBaseline(project.costBaselineIdr ?? '');
    setRevenue(project.totalRevenueIdr ?? '');
    setErr('');
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${project.id}`, {
      name,
      clientName: clientName || null,
      sponsor: sponsor || null,
      category: category || null,
      costBaselineIdr: costBaseline === '' ? null : Number(costBaseline),
      totalRevenueIdr: revenue === '' ? null : Number(revenue),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      setOpen(false);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  if (!canEdit) return null;

  return (
    <>
      <Button variant="secondary" onClick={start}>Edit details</Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-100">Edit Project Details</h2>
            <div className="space-y-3">
              <Field label="Project name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client">
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Bank XYZ" />
                </Field>
                <Field label="Sponsor">
                  <Input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. CISO Office" />
                </Field>
                <Field label="Project category">
                  <Select value={category} onChange={(e) => setCategory(e.target.value as ProjectCategory | '')}>
                    <option value="">— select —</option>
                    {PROJECT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </Field>
                <div />
                <Field label="Cost Baseline (IDR)">
                  <Input type="number" min={0} value={costBaseline} onChange={(e) => setCostBaseline(e.target.value)} />
                </Field>
                <Field label="Total Revenue (IDR)">
                  <Input type="number" min={0} value={revenue} onChange={(e) => setRevenue(e.target.value)} />
                </Field>
              </div>
              {costBaseline !== '' && revenue !== '' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Projected margin: {formatIdr(Number(revenue) - Number(costBaseline))}
                  {Number(costBaseline) > 0 && ` (${(((Number(revenue) - Number(costBaseline)) / Number(costBaseline)) * 100).toFixed(1)}%)`}
                </p>
              )}
              {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
                <Button className="flex-1" disabled={!name || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
