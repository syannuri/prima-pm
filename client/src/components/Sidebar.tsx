import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';

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
};

const STATUS_DOT: Record<string, string> = {
  DRAFT: 'bg-slate-500',
  CHARTERED: 'bg-brand-400',
  IN_PROGRESS: 'bg-amber-400',
  ON_HOLD: 'bg-amber-400',
  CLOSED: 'bg-green-400',
};

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
      <div className={`flex h-14 items-center gap-2 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <Logo className="h-8 w-8 shrink-0" />
        {!collapsed && <span className="text-base font-semibold text-white">Precise</span>}
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
