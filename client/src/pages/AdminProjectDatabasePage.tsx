import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Project, ProjectStatus } from '../api/types';
import { Badge, Button, Card, Input, SectionTitle, Select, Spinner, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import EditProjectModal from '../components/EditProjectModal';
import { DELIVERY_APPROACH_LABEL, PROJECT_STATUS_BADGE, categoryLabel } from '../lib/labels';
import { formatIdrShort } from '../lib/format';
import { projectAccent } from '../lib/projectColor';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: 'Draft',
  CHARTERED: 'Chartered',
  IN_PROGRESS: 'In-progress',
  ON_HOLD: 'On-hold',
  CLOSED: 'Closed',
};
const STATUSES: ProjectStatus[] = ['DRAFT', 'CHARTERED', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED'];

// Year is encoded in the project code: PRJ-YYYY-####.
const yearOf = (code: string): string => code.match(/^PRJ-(\d{4})-/)?.[1] ?? '—';

type SortKey = 'code' | 'name' | 'pm' | 'year' | 'status' | 'budget';
type SortDir = 'asc' | 'desc';

export default function AdminProjectDatabasePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [year, setYear] = useState('');
  const [pmId, setPmId] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editing, setEditing] = useState<Project | null>(null);

  const archived = tab === 'archived';
  const projectsQ = useQuery({
    // Prefixed with 'projects' so the edit/archive mutations' invalidateQueries(['projects']) refresh it.
    queryKey: ['projects', 'admin-db', archived],
    queryFn: () => api.get<{ projects: Project[] }>(`/projects/admin/database?archived=${archived}`),
  });
  const rows = projectsQ.data?.projects ?? [];

  // Filter dropdown options are derived from the full set for the current tab (stable regardless
  // of the other active filters).
  const years = useMemo(() => Array.from(new Set(rows.map((p) => yearOf(p.code)))).filter((y) => y !== '—').sort().reverse(), [rows]);
  const pms = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((p) => { if (p.pm) m.set(p.pm.id, p.pm.name); });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((p) => {
      if (status && p.status !== status) return false;
      if (year && yearOf(p.code) !== year) return false;
      if (pmId && p.pmUserId !== pmId) return false;
      if (needle && !`${p.code} ${p.name} ${p.clientName ?? ''} ${p.pm?.name ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const val = (p: Project): string | number => {
      switch (sortKey) {
        case 'name': return p.name.toLowerCase();
        case 'pm': return p.pm?.name?.toLowerCase() ?? '';
        case 'year': return yearOf(p.code);
        case 'status': return STATUSES.indexOf(p.status);
        case 'budget': return Number(p.costBaseline?.budgetAtCompletion ?? 0);
        default: return p.code;
      }
    };
    out.sort((a, b) => {
      const av = val(a); const bv = val(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [rows, q, status, year, pmId, sortKey, sortDir]);

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'budget' || k === 'year' ? 'desc' : 'asc'); }
  };

  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${id}/archive`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['portfolio'] }); toast.success('Project archived'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not archive'),
  });
  const unarchive = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${id}/unarchive`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['portfolio'] }); toast.success('Project restored'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not restore'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['portfolio'] }); toast.success('Project deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not delete'),
  });

  const doArchive = async (p: Project) => {
    if (await confirm({
      title: 'Archive project?',
      message: `"${p.name}" (${p.code}) will move to the Archive and disappear from the database and dashboard. You can restore it here any time.`,
      confirmLabel: 'Archive',
    })) archive.mutate(p.id);
  };
  const doDelete = async (p: Project) => {
    if (await confirm({
      title: 'Delete project?',
      message: `This permanently removes "${p.name}" (${p.code}) from the system. This cannot be undone. To keep the data, use Archive instead.`,
      confirmLabel: 'Delete',
      danger: true,
    })) remove.mutate(p.id);
  };

  const th = (k: SortKey, label: string, extra = '') => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-semibold hover:text-brand-600 dark:hover:text-brand-400 ${extra}`} onClick={() => sortBy(k)}>
      {label}{sortKey === k && <span className="ml-1 text-brand-500">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  const clearFilters = () => { setQ(''); setStatus(''); setYear(''); setPmId(''); };
  const hasFilters = !!(q || status || year || pmId);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle sub="Manage every corporate project — filter, sort, edit, archive or delete. Archived projects are hidden from the dashboard and the main list.">
          Project Database
        </SectionTitle>
        <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
          {(['active', 'archived'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === t ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              {t === 'active' ? 'Database' : 'Archive'}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {/* Filters */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Input placeholder="Search code, name, client, PM…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | '')}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select value={pmId} onChange={(e) => setPmId(e.target.value)}>
            <option value="">All PMs</option>
            {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="mb-3 flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span>{filtered.length} project{filtered.length === 1 ? '' : 's'}{archived ? ' archived' : ''}</span>
          {hasFilters && <button onClick={clearFilters} className="text-brand-600 hover:underline dark:text-brand-400">Clear filters</button>}
        </div>

        {projectsQ.isLoading ? (
          <div className="py-12 text-center"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="📁" title={archived ? 'No archived projects' : (hasFilters ? 'No projects match these filters' : 'No projects yet')} hint={archived ? 'Projects you archive will appear here.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  {th('code', 'Code')}
                  {th('name', 'Project')}
                  {th('pm', 'PM')}
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">Category</th>
                  {th('year', 'Year')}
                  {th('status', 'Status')}
                  {th('budget', 'Budget (BAC)', 'text-right')}
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className={`whitespace-nowrap border-l-4 px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400 ${projectAccent(p.id).spine}`}>{p.code}</td>
                    <td className="px-3 py-2">
                      <Link to={`/projects/${p.id}`} className="font-medium text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400">{p.name}</Link>
                      <div className="text-xs text-slate-400">{DELIVERY_APPROACH_LABEL[p.deliveryApproach]}{p.clientName ? ` · ${p.clientName}` : ''}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">{p.pm?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{categoryLabel(p.category, p.categoryOther) ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">{yearOf(p.code)}</td>
                    <td className="px-3 py-2"><Badge color={PROJECT_STATUS_BADGE[p.status]} solid>{STATUS_LABEL[p.status]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-slate-800 dark:text-slate-100">{p.costBaseline ? formatIdrShort(p.costBaseline.budgetAtCompletion) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(p)}>Edit</Button>
                        {archived ? (
                          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={unarchive.isPending} onClick={() => unarchive.mutate(p.id)}>Restore</Button>
                        ) : (
                          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={archive.isPending} onClick={() => doArchive(p)}>Archive</Button>
                        )}
                        <Button variant="ghost" className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40" onClick={() => doDelete(p)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <EditProjectModal project={editing} open onOpenChange={(v) => { if (!v) setEditing(null); }} />
      )}
    </div>
  );
}
