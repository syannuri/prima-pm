import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { DeliveryApproach, Project, ProjectCategory } from '../api/types';
import { Button, Field, Input, Modal, MoneyInput, Select } from './ui';
import type { InputState } from './ui';
import { DELIVERY_APPROACH_LABEL, PROJECT_CATEGORIES } from '../lib/labels';

const APPROACHES: DeliveryApproach[] = ['PREDICTIVE', 'AGILE', 'HYBRID'];
import { formatIdr } from '../lib/format';
import { useAuth } from '../context/AuthContext';

// Edit a project's high-level details. Backend enforces write access (owning PM,
// or any ADMIN/PMO); we also gate the trigger by role.
// Controlled mode: pass `open` + `onOpenChange` (e.g. to drive it from an overflow menu) and the
// component renders only the modal, no trigger button. Uncontrolled (no props): renders its own
// "Edit details" button as before.
export default function EditProjectModal({ project, open: openProp, onOpenChange }: { project: Project; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const controlled = onOpenChange !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlled ? !!openProp : uncontrolledOpen;
  const setOpen = controlled ? onOpenChange! : setUncontrolledOpen;
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(project.code);
  const [clientName, setClientName] = useState(project.clientName ?? '');
  const [sponsor, setSponsor] = useState(project.sponsor ?? '');
  const [category, setCategory] = useState<ProjectCategory | ''>(project.category ?? '');
  const [categoryOther, setCategoryOther] = useState(project.categoryOther ?? '');
  const [deliveryApproach, setDeliveryApproach] = useState<DeliveryApproach>(project.deliveryApproach);
  const [costBaseline, setCostBaseline] = useState(project.costBaselineIdr ?? '');
  const [revenue, setRevenue] = useState(project.totalRevenueIdr ?? '');
  const [err, setErr] = useState('');
  // Per-field validation surfacing (same pattern as the Charter / New Project forms).
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  // Editing top-level project details is a PMO/portfolio governance action.
  const canEdit = !!user && ['ADMIN', 'PMO'].includes(user.role);

  // Reset the form to the project's current values whenever the modal opens (works for both the
  // uncontrolled button and a controlled open from an overflow menu).
  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setCode(project.code);
    setClientName(project.clientName ?? '');
    setSponsor(project.sponsor ?? '');
    setCategory(project.category ?? '');
    setCategoryOther(project.categoryOther ?? '');
    setDeliveryApproach(project.deliveryApproach);
    setCostBaseline(project.costBaselineIdr ?? '');
    setRevenue(project.totalRevenueIdr ?? '');
    setErr('');
    setTouched({});
    setShowAllErrors(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only `name` (min 2 chars) and — when category is Other — its free-text detail are mandatory;
  // everything else is nullable in the update schema.
  const missing: Record<string, boolean> = {
    name: name.trim().length < 2,
    categoryOther: category === 'OTHER' && categoryOther.trim() === '',
  };
  const showErr = (k: string) => missing[k] && (showAllErrors || !!touched[k]);
  const errState = (k: string): InputState => (showErr(k) ? 'invalid' : 'none');
  const nameError = showErr('name') ? (name.trim() ? 'Nama minimal 2 karakter' : 'Field ini wajib diisi') : undefined;
  const categoryOtherError = showErr('categoryOther') ? 'Jelaskan kategori "Other"' : undefined;
  const canSubmit = !missing.name && !missing.categoryOther;
  const submit = () => {
    if (!canSubmit) { setShowAllErrors(true); touch('name'); return; }
    save.mutate();
  };

  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${project.id}`, {
      name,
      code: code.trim() || undefined,
      clientName: clientName || null,
      sponsor: sponsor || null,
      category: category || null,
      categoryOther: category === 'OTHER' ? (categoryOther.trim() || null) : null,
      deliveryApproach,
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
      {!controlled && <Button variant="secondary" onClick={() => setOpen(true)}>Edit details</Button>}

      {open && (
        <Modal onClose={() => setOpen(false)} title="Edit Project Details" size="lg">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Project name" required error={nameError}>
                  <Input state={errState('name')} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => touch('name')} />
                </Field>
                <Field label="Project code">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} placeholder="e.g. PRJ-2026-0001" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client">
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Bank XYZ" />
                </Field>
                <Field label="Sponsor">
                  <Input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. CISO Office" />
                </Field>
                <Field label="Project category" error={categoryOtherError}>
                  <Select value={category} onChange={(e) => setCategory(e.target.value as ProjectCategory | '')}>
                    <option value="">— select —</option>
                    {PROJECT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                  {category === 'OTHER' && (
                    <Input className="mt-2" state={errState('categoryOther')} value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} onBlur={() => touch('categoryOther')} placeholder="Describe the category" />
                  )}
                </Field>
                <Field label="Delivery approach" hint="Agile/Hybrid unlocks the Backlog & Board">
                  <Select value={deliveryApproach} onChange={(e) => setDeliveryApproach(e.target.value as DeliveryApproach)}>
                    {APPROACHES.map((a) => <option key={a} value={a}>{DELIVERY_APPROACH_LABEL[a]}</option>)}
                  </Select>
                </Field>
                <Field label="Cost Baseline (IDR)">
                  <MoneyInput value={costBaseline} onValueChange={setCostBaseline} />
                </Field>
                <Field label="Total Revenue (IDR)">
                  <MoneyInput value={revenue} onValueChange={setRevenue} />
                </Field>
              </div>
              {costBaseline !== '' && revenue !== '' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Projected margin: {formatIdr(Number(revenue) - Number(costBaseline))}
                  {Number(revenue) > 0 && ` (${(((Number(revenue) - Number(costBaseline)) / Number(revenue)) * 100).toFixed(1)}%)`}
                </p>
              )}
              {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
                <Button className="flex-1" disabled={save.isPending} onClick={submit}>
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
        </Modal>
      )}
    </>
  );
}
