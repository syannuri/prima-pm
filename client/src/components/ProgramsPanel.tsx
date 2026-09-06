import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Card, Input } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { formatIdrShort } from '../lib/format';

// Program (portfolio hierarchy) roll-up + management on the desktop dashboard. Everyone sees the roll-up
// cards; ADMIN/PMO can create programs, assign/detach projects, and delete programs. Self-hides when there
// are no programs and the viewer can't manage (keeps the dashboard tidy for teams not using programs).
type Health = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
interface ProgramRollup {
  id: string;
  code: string | null;
  name: string;
  projectCount: number;
  bac: number;
  ev: number;
  ac: number;
  spi: number;
  cpi: number;
  percentComplete: number;
  health: Health;
  costHealth: Health;
}

const HEALTH_CLASS: Record<Health, string> = {
  GREEN: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  AMBER: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  RED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  NO_DATA: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

function HealthChip({ label, health }: { label: string; health: Health }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${HEALTH_CLASS[health]}`}>{label} {health === 'NO_DATA' ? '—' : health[0] + health.slice(1).toLowerCase()}</span>;
}

export default function ProgramsPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isManager = !!user && ['ADMIN', 'PMO'].includes(user.role);

  const rollupQ = useQuery({ queryKey: ['programs', 'rollup'], queryFn: () => api.get<{ programs: ProgramRollup[] }>('/programs/rollup') });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: Project[] }>('/projects') });

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [manageId, setManageId] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['programs'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const create = useMutation({
    mutationFn: () => api.post('/programs', { name: newName.trim(), code: newCode.trim() || undefined }),
    onSuccess: () => { setNewName(''); setNewCode(''); toast.success('Program created'); refresh(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/programs/${id}`),
    onSuccess: () => { toast.success('Program deleted'); setManageId(null); refresh(); },
    onError: onErr,
  });
  const assign = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) => api.post(`/programs/${id}/projects`, { projectId }),
    onSuccess: refresh,
    onError: onErr,
  });
  const detach = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) => api.del(`/programs/${id}/projects/${projectId}`),
    onSuccess: refresh,
    onError: onErr,
  });

  const programs = rollupQ.data?.programs ?? [];
  const projects = projectsQ.data?.projects ?? [];

  if (rollupQ.isLoading) return null;
  if (programs.length === 0 && !isManager) return null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Programs</h2>
          <p className="text-xs text-slate-400">Grouped delivery — health &amp; earned value rolled up across member projects.</p>
        </div>
      </div>

      {isManager && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New program name" className="max-w-xs" />
          <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Code (optional)" className="max-w-[8rem]" />
          <Button type="button" onClick={() => create.mutate()} disabled={!newName.trim() || create.isPending}>Add program</Button>
        </div>
      )}

      {programs.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No programs yet. Create one above, then assign projects to it.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {programs.map((p) => {
            const members = projects.filter((pr) => pr.programId === p.id);
            const assignable = projects.filter((pr) => pr.programId !== p.id);
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {p.code && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{p.code}</span>}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{p.name}</span>
                  <span className="text-xs text-slate-400">{p.projectCount} project{p.projectCount === 1 ? '' : 's'}</span>
                  <HealthChip label="Sched" health={p.health} />
                  <HealthChip label="Cost" health={p.costHealth} />
                  {isManager && (
                    <button onClick={() => setManageId(manageId === p.id ? null : p.id)} className="ml-auto text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                      {manageId === p.id ? 'Close' : 'Manage'}
                    </button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-5 dark:text-slate-400">
                  <div><span className="block font-semibold text-slate-700 dark:text-slate-200">{p.percentComplete}%</span>complete</div>
                  <div><span className="block font-semibold text-slate-700 dark:text-slate-200">{p.spi.toFixed(2)}</span>SPI</div>
                  <div><span className="block font-semibold text-slate-700 dark:text-slate-200">{p.cpi.toFixed(2)}</span>CPI</div>
                  <div><span className="block font-semibold text-slate-700 dark:text-slate-200">{formatIdrShort(p.ev)}</span>EV</div>
                  <div><span className="block font-semibold text-slate-700 dark:text-slate-200">{formatIdrShort(p.bac)}</span>BAC</div>
                </div>

                {manageId === p.id && isManager && (
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { assign.mutate({ id: p.id, projectId: e.target.value }); e.target.value = ''; } }}
                      >
                        <option value="">+ Add a project…</option>
                        {assignable.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} · {pr.name}</option>)}
                      </select>
                      <button onClick={() => { if (confirm(`Delete program "${p.name}"? Member projects are detached, not deleted.`)) remove.mutate(p.id); }} className="ml-auto text-xs font-medium text-red-500 hover:text-red-600">
                        Delete program
                      </button>
                    </div>
                    {members.length > 0 && (
                      <ul className="space-y-1">
                        {members.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <span className="truncate">{m.code} · {m.name}</span>
                            <button onClick={() => detach.mutate({ id: p.id, projectId: m.id })} className="ml-auto text-xs text-slate-400 hover:text-red-500" aria-label={`Remove ${m.name}`}>✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
