import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project, ProjectCategory, User } from '../api/types';
import { Badge, Button, Card, Field, Input, Select, SectionTitle, Spinner } from '../components/ui';
import { formatIdr } from '../lib/format';
import { PROJECT_CATEGORIES } from '../lib/labels';
import { useAuth } from '../context/AuthContext';
import PortfolioSummary from '../components/PortfolioSummary';
import ResourceCapacity from '../components/ResourceCapacity';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'slate',
  CHARTERED: 'indigo',
  IN_PROGRESS: 'amber',
  ON_HOLD: 'amber',
  CLOSED: 'green',
};

export default function DashboardPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState<'portfolio' | 'resources' | 'cards'>('portfolio');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [category, setCategory] = useState<ProjectCategory | ''>('');
  const [costBaseline, setCostBaseline] = useState('');
  const [revenue, setRevenue] = useState('');
  const [pmUserId, setPmUserId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });
  // PMO assigns the project to a PM at creation.
  const usersQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory'), enabled: showForm });

  const resetForm = () => { setName(''); setCode(''); setClientName(''); setSponsor(''); setCategory(''); setCostBaseline(''); setRevenue(''); setPmUserId(''); };
  const create = useMutation({
    mutationFn: () => api.post<{ project: Project }>('/projects', {
      name,
      code: code.trim() || undefined,
      clientName: clientName || undefined,
      sponsor: sponsor || undefined,
      category: category || undefined,
      costBaselineIdr: costBaseline ? Number(costBaseline) : undefined,
      totalRevenueIdr: revenue ? Number(revenue) : undefined,
      pmUserId: pmUserId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setShowForm(false);
      resetForm();
    },
  });

  // PMO/Admin get the portfolio-wide framing; PMs see a "my projects" view.
  const isPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const canCreate = isPmo;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle sub={isPmo ? 'Cross-project EVM portfolio & project directory' : 'Your projects — health, cost & schedule'}>Dashboard</SectionTitle>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-sm">
            <button
              onClick={() => setView('portfolio')}
              className={`rounded-md px-3 py-1 ${view === 'portfolio' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
            >
              {isPmo ? 'Portfolio EVM' : 'My Projects'}
            </button>
            <button
              onClick={() => setView('resources')}
              className={`rounded-md px-3 py-1 ${view === 'resources' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
            >
              Utilization
            </button>
            <button
              onClick={() => setView('cards')}
              className={`rounded-md px-3 py-1 ${view === 'cards' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
            >
              Project Cards
            </button>
          </div>
          {canCreate && <Button onClick={() => setShowForm((s) => !s)}>+ New Project</Button>}
        </div>
      </div>

      {view === 'portfolio' && <PortfolioSummary />}
      {view === 'resources' && <ResourceCapacity />}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-100">New Project</h2>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Create a project shell, then build its Charter, WBS, Cost & Risk.</p>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Project name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SOC Modernization" />
                </Field>
                <Field label="Project code">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto-generated if blank" />
                </Field>
              </div>
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
                <Field label="Assign Project Manager">
                  <Select value={pmUserId} onChange={(e) => setPmUserId(e.target.value)}>
                    <option value="">— unassigned —</option>
                    {usersQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </Select>
                </Field>
                <Field label="Cost Baseline (IDR)">
                  <Input type="number" min={0} value={costBaseline} onChange={(e) => setCostBaseline(e.target.value)} placeholder="e.g. 1000000000" />
                </Field>
                <Field label="Total Revenue (IDR)">
                  <Input type="number" min={0} value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="e.g. 1500000000" />
                </Field>
              </div>
              {costBaseline && revenue && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Projected margin: {formatIdr(Number(revenue) - Number(costBaseline))}
                  {Number(costBaseline) > 0 && ` (${(((Number(revenue) - Number(costBaseline)) / Number(costBaseline)) * 100).toFixed(1)}%)`}
                </p>
              )}
              {create.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{(create.error as Error).message}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
                <Button className="flex-1" onClick={() => create.mutate()} disabled={!name || create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create Project'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'cards' && (isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !data?.projects.length ? (
        <Card>
          <p className="text-center text-slate-500 dark:text-slate-400">No projects yet. Create your first project to begin.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{p.code}</span>
                  <Badge color={STATUS_COLOR[p.status]}>{p.status}</Badge>
                </div>
                <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{p.name}</h3>
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                  {p.clientName ? `Client: ${p.clientName}` : (p.sponsor ?? 'No client')}
                </p>
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3 text-sm">
                  <span className="text-slate-500 dark:text-slate-400">PM: {p.pm?.name ?? '—'}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {p.costBaseline ? formatIdr(p.costBaseline.budgetAtCompletion) : '—'}
                  </span>
                </div>
                {!!p.changeCount && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                    <span>🕓</span>
                    <span><span className="font-medium text-slate-600 dark:text-slate-300">{p.changeCount}</span> changes</span>
                  </div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
