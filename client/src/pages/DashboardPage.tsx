import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { Badge, Button, Card, Field, Input, SectionTitle, Spinner } from '../components/ui';
import { formatIdr } from '../lib/format';
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
  const [sponsor, setSponsor] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });

  const create = useMutation({
    mutationFn: () => api.post<{ project: Project }>('/projects', { name, sponsor: sponsor || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setShowForm(false);
      setName('');
      setSponsor('');
    },
  });

  const canCreate = user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle sub="Cross-project EVM portfolio & project directory">Dashboard</SectionTitle>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-sm">
            <button
              onClick={() => setView('portfolio')}
              className={`rounded-md px-3 py-1 ${view === 'portfolio' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
            >
              Portfolio EVM
            </button>
            <button
              onClick={() => setView('resources')}
              className={`rounded-md px-3 py-1 ${view === 'resources' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
            >
              Resources
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
        <Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Project name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SOC Modernization" />
            </Field>
            <Field label="Sponsor">
              <Input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. CISO Office" />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
          {create.isError && <p className="mt-2 text-sm text-red-600">{(create.error as Error).message}</p>}
        </Card>
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
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{p.sponsor ?? 'No sponsor'}</p>
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3 text-sm">
                  <span className="text-slate-500 dark:text-slate-400">PM: {p.pm?.name ?? '—'}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {p.costBaseline ? formatIdr(p.costBaseline.budgetAtCompletion) : '—'}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
