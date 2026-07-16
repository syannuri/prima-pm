import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { PROJECT_STATUS_DOT } from '../lib/labels';

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  users: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.9M16 3.1A4 4 0 0 1 16 11',
  resources: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13-1-2 2-1-1m1-4v6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  manual: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  changeLog: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12l2 2 4-4',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  reports: 'M3 3v18h18M7 15v3M12 11v7M17 7v11',
};

const STATUS_DOT = PROJECT_STATUS_DOT;

const linkBase = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition';
const linkIdle = 'text-slate-300 hover:bg-slate-800 hover:text-white';
// Active item: soft coral wash + a crisp coral left accent bar.
const linkActive = 'bg-brand-600/15 text-white shadow-[inset_2px_0_0_#f4675f]';

export default function Sidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { user } = useAuth();
  const isAdminPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const { data, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });
  const { data: changes } = useQuery({
    queryKey: ['changes'],
    queryFn: () => api.get<{ unread: number }>('/notifications/changes'),
    enabled: isAdminPmo,
    refetchInterval: 60_000,
  });
  const [showAllProjects, setShowAllProjects] = useState(false);
  // Active work first so the most relevant projects stay near the top of a long list.
  const STATUS_RANK: Record<string, number> = { IN_PROGRESS: 0, ON_HOLD: 1, CHARTERED: 2, DRAFT: 3, CLOSED: 4 };
  const projects = [...(data?.projects ?? [])].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.name.localeCompare(b.name),
  );
  const CAP = 8;
  const visibleProjects = collapsed || showAllProjects ? projects : projects.slice(0, CAP);
  const unread = isAdminPmo ? changes?.unread ?? 0 : 0;
  const cx = (active: boolean) => `${linkBase} ${collapsed ? 'justify-center px-0' : ''} ${active ? linkActive : linkIdle}`;

  return (
    <div className={`flex h-full flex-col bg-slate-900 text-slate-300 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}>
      <div className={`flex h-14 items-center ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <span className={`relative inline-block border-[3px] border-white dark:border-white font-brand font-bold tracking-wide text-white ${collapsed ? 'px-2 py-0.5 text-sm' : 'px-2.5 py-1 text-base'}`}>
          {collapsed ? 'P' : 'PRISMATIX'}
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-white" />
        </span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        <NavLink to="/" end onClick={onNavigate} title={unread > 0 ? `Dashboard — ${unread} unread changes` : 'Dashboard'} className={({ isActive }) => `relative ${cx(isActive)}`}>
          <Icon path={ICONS.home} /> {!collapsed && 'Dashboard'}
          {unread > 0 && (collapsed ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-slate-900" />
          ) : (
            <span className="ml-auto grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">{unread}</span>
          ))}
        </NavLink>
        {/* Reports — PM status report (weekly/monthly); PMs run them, ADMIN/PMO oversee. A guest
            gets the same hub scoped to their own personal projects. */}
        {!!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'GUEST'].includes(user.role) && (
          <NavLink to="/reports" onClick={onNavigate} title={user.role === 'GUEST' ? 'My Reports' : 'Reports'} className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.reports} /> {!collapsed && (user.role === 'GUEST' ? 'My Reports' : 'Reports')}
          </NavLink>
        )}
        {/* Timesheet is for people who do task work — hide it for ADMIN/PMO (portfolio roles). */}
        {!!user && !['ADMIN', 'PMO'].includes(user.role) && (
          <NavLink to="/my-timesheet" onClick={onNavigate} title="My Timesheet" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.clock} /> {!collapsed && 'My Timesheet'}
          </NavLink>
        )}
        {user?.role === 'ADMIN' && (
          <NavLink to="/admin/users" onClick={onNavigate} title="Users" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.users} /> {!collapsed && 'Users'}
          </NavLink>
        )}
        {user?.role === 'ADMIN' && (
          <NavLink to="/admin/audit" onClick={onNavigate} title="Audit trail" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.changeLog} /> {!collapsed && 'Audit trail'}
          </NavLink>
        )}
        {!!user && ['ADMIN', 'PMO', 'FINANCE', 'GUEST'].includes(user.role) && (
          <NavLink to="/admin/resources" onClick={onNavigate} title={user.role === 'GUEST' ? 'My Resource Pool' : 'Resource Pool'} className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.resources} /> {!collapsed && (user.role === 'GUEST' ? 'My Resources' : 'Resource Pool')}
          </NavLink>
        )}
        {!collapsed && <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Projects</div>}
        {collapsed && <div className="my-2 border-t border-slate-800" />}
        {/* Don't flash "No projects yet" while the list is still loading (looks like the
            projects vanished on a slow first paint). */}
        {!collapsed && projectsLoading && projects.length === 0 && <div className="px-3 py-1 text-xs text-slate-500">Loading…</div>}
        {!collapsed && !projectsLoading && projects.length === 0 && <div className="px-3 py-1 text-xs text-slate-500">No projects yet</div>}
        {visibleProjects.map((p) => (
          <NavLink key={p.id} to={`/projects/${p.id}`} onClick={onNavigate} title={p.name} className={({ isActive }) => cx(isActive)}>
            {collapsed ? (
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white ${STATUS_DOT[p.status] ?? 'bg-slate-500'}`}>
                {p.name[0]?.toUpperCase() ?? '?'}
              </span>
            ) : (
              <>
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[p.status] ?? 'bg-slate-500'}`} />
                <span className="truncate">{p.name}</span>
              </>
            )}
          </NavLink>
        ))}
        {!collapsed && projects.length > CAP && (
          <button
            onClick={() => setShowAllProjects((s) => !s)}
            className="w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            {showAllProjects ? '▴ Show less' : `▾ Show all ${projects.length}`}
          </button>
        )}
      </nav>

      <div className="space-y-1 border-t border-slate-800 px-3 py-2">
        <NavLink to="/manual" onClick={onNavigate} title="Manual" className={({ isActive }) => cx(isActive)}>
          <Icon path={ICONS.manual} /> {!collapsed && 'Manual'}
        </NavLink>
        <NavLink to="/settings" onClick={onNavigate} title="Settings" className={({ isActive }) => cx(isActive)}>
          <Icon path={ICONS.settings} /> {!collapsed && 'Settings'}
        </NavLink>
      </div>

      <div className={`flex items-center gap-3 border-t border-slate-800 py-3 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600/80 text-sm font-semibold text-white" title={user?.name}>
          {user?.name?.[0]?.toUpperCase() ?? '?'}
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{user?.name}</div>
            <div className="truncate text-xs text-slate-400">{user?.role}</div>
          </div>
        )}
      </div>
    </div>
  );
}
