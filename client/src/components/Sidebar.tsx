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
};

const STATUS_DOT = PROJECT_STATUS_DOT;

const linkBase = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition';
const linkIdle = 'text-slate-300 hover:bg-slate-800 hover:text-white';
// Active item: soft coral wash + a crisp coral left accent bar.
const linkActive = 'bg-brand-600/15 text-white shadow-[inset_2px_0_0_#f4675f]';

export default function Sidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { user } = useAuth();
  const isAdminPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const { data } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });
  const { data: changes } = useQuery({
    queryKey: ['changes'],
    queryFn: () => api.get<{ unread: number }>('/notifications/changes'),
    enabled: isAdminPmo,
    refetchInterval: 60_000,
  });
  const projects = data?.projects ?? [];
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
        <NavLink to="/my-timesheet" onClick={onNavigate} title="My Timesheet" className={({ isActive }) => cx(isActive)}>
          <Icon path={ICONS.clock} /> {!collapsed && 'My Timesheet'}
        </NavLink>
        {user?.role === 'ADMIN' && (
          <NavLink to="/admin/users" onClick={onNavigate} title="Users" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.users} /> {!collapsed && 'Users'}
          </NavLink>
        )}
        {!!user && ['ADMIN', 'PMO', 'FINANCE'].includes(user.role) && (
          <NavLink to="/admin/resources" onClick={onNavigate} title="Resource Pool" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.resources} /> {!collapsed && 'Resource Pool'}
          </NavLink>
        )}
        {!collapsed && <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Projects</div>}
        {collapsed && <div className="my-2 border-t border-slate-800" />}
        {!collapsed && projects.length === 0 && <div className="px-3 py-1 text-xs text-slate-500">No projects yet</div>}
        {projects.map((p) => (
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
