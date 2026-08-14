import { useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { projectAccent } from '../lib/projectColor';
import { isPlatformRoute } from '../lib/platformConsole';
import AvatarMenu from './AvatarMenu';

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
  database: 'M4 7c0 1.66 3.58 3 8 3s8-1.34 8-3-3.58-3-8-3-8 1.34-8 3zM4 7v5c0 1.66 3.58 3 8 3s8-1.34 8-3V7M4 12v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  org: 'M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M14 9h.01M10 13h.01M14 13h.01M10 17h.01M14 17h.01',
  tenants: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  billing: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7zM2 10h20M6 15h4',
  approvals: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 14l2 2 4-4',
};

const linkBase = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition';
// Elegant dark charcoal rail in BOTH themes: idle = muted light-grey, hover = subtle white wash +
// a hairline ring tracing the rounded shape (transparent at rest → no layout shift).
const linkIdle = 'text-slate-300 ring-1 ring-transparent hover:bg-white/10 hover:text-white hover:ring-white/15';
// Active item: a faint BLUE wash + blue-tinted glyph/label + a crisp blue left accent bar AND a
// delicate blue ring frame, so "you are here" reads in the accent colour (matches the project tab
// accent), not just white.
const linkActive = 'bg-blue-500/15 text-blue-100 ring-1 ring-inset ring-blue-400/30 shadow-[inset_2px_0_0_theme(colors.blue.500)]';
// Platform-console "Control Plane" skin: violet-tinted active item on the deep-indigo rail, so
// "you are here" reads in the elevated-privilege accent (not the normal blue).
const linkActivePlatform = 'bg-violet-500/20 text-violet-100 ring-1 ring-inset ring-violet-400/40 shadow-[inset_2px_0_0_theme(colors.violet.400)]';
// Small uppercase group heading between nav sections (Workspace / Manage / Projects).
const sectionLabel = 'px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400';

// `drawer` = rendered as the mobile slide-over (not the fixed web sidebar). The Manual/Settings
// footer is drawer-only: on the web those live in the header top-bar, so the sidebar hides them.
export default function Sidebar({ collapsed = false, onNavigate, drawer = false }: { collapsed?: boolean; onNavigate?: () => void; drawer?: boolean }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isAdminPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);
  // Platform "Control Plane" skin — on the super-admin routes only (context, not account).
  const platform = !!user?.isPlatformAdmin && isPlatformRoute(pathname);
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
  // Unread direct messages — drives the Messages nav badge. Guests can't message.
  const isGuest = user?.role === 'GUEST';
  const { data: chatUnread } = useQuery({
    queryKey: ['chat-unread'],
    queryFn: () => api.get<{ unread: number }>('/messages/unread-count'),
    enabled: !!user && !isGuest,
    refetchInterval: 30_000,
  });
  const chatUnreadCount = chatUnread?.unread ?? 0;
  // Pending approvals routed to this user by an approval workflow — drives the Approvals nav badge.
  const { data: approvalsCount } = useQuery({
    queryKey: ['my-approvals-count'],
    queryFn: () => api.get<{ count: number }>('/approvals/mine/count'),
    enabled: !!user && !isGuest,
    refetchInterval: 60_000,
  });
  const pendingApprovals = approvalsCount?.count ?? 0;
  const [showAllProjects, setShowAllProjects] = useState(false);
  // Collapsed icon-rail hover tooltip: one delegated handler reads the hovered link's aria-label
  // and shows a portal tooltip (portaled + fixed so it escapes the nav's overflow clipping).
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  // Active work first so the most relevant projects stay near the top of a long list.
  const STATUS_RANK: Record<string, number> = { IN_PROGRESS: 0, ON_HOLD: 1, CHARTERED: 2, DRAFT: 3, CLOSED: 4 };
  const projects = [...(data?.projects ?? [])].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.name.localeCompare(b.name),
  );
  const CAP = 8;
  const visibleProjects = collapsed || showAllProjects ? projects : projects.slice(0, CAP);
  const unread = isAdminPmo ? changes?.unread ?? 0 : 0;
  const cx = (active: boolean) => `${linkBase} ${collapsed ? 'justify-center px-0' : ''} ${active ? (platform ? linkActivePlatform : linkActive) : linkIdle}`;

  return (
    <div className={`flex h-full flex-col border-r shadow-[6px_0_24px_-18px_rgba(0,0,0,0.55)] transition-[width,background-color] duration-200 ${collapsed ? 'w-16' : 'w-60'} ${platform ? 'border-violet-400/20 bg-indigo-950 text-indigo-200' : 'border-black/20 bg-slate-800 text-slate-300'}`}>
      <div className={`flex h-14 items-center ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <span className={`relative inline-block border-[3px] font-brand font-bold tracking-wide text-white ${platform ? 'border-violet-300' : 'border-white'} ${collapsed ? 'px-2 py-0.5 text-sm' : 'px-2.5 py-1 text-base'}`}>
          {collapsed ? (platform ? '◆' : 'P') : (platform ? 'PLATFORM' : 'PRISMATIX')}
          <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${platform ? 'bg-violet-400' : 'bg-brand-500'}`} />
        </span>
        {platform && !collapsed && <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/80">console</span>}
      </div>

      <nav
        className="scrollbar-sidebar flex-1 space-y-1 overflow-y-auto px-3 py-2"
        onMouseOver={collapsed && !drawer ? (e) => {
          const a = (e.target as HTMLElement).closest('a[aria-label]');
          if (a) { const r = a.getBoundingClientRect(); setTip({ label: a.getAttribute('aria-label') || '', top: r.top + r.height / 2 }); }
          else setTip(null);
        } : undefined}
        onMouseLeave={() => setTip(null)}
      >
        {!collapsed && <div className={sectionLabel}>Workspace</div>}
        <NavLink to="/" end onClick={onNavigate} aria-label={unread > 0 ? `Dashboard — ${unread} unread changes` : 'Dashboard'} className={({ isActive }) => `relative ${cx(isActive)}`}>
          <Icon path={ICONS.home} /> {!collapsed && 'Dashboard'}
          {unread > 0 && (collapsed ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-slate-800" />
          ) : (
            <span className="ml-auto grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">{unread}</span>
          ))}
        </NavLink>
        {/* Messages — private 1-to-1 direct chat. Hidden for sandboxed guests. */}
        {!!user && !isGuest && (
          <NavLink to="/messages" onClick={onNavigate} aria-label={chatUnreadCount > 0 ? `Messages — ${chatUnreadCount} unread` : 'Messages'} className={({ isActive }) => `relative ${cx(isActive)}`}>
            <Icon path={ICONS.chat} /> {!collapsed && 'Messages'}
            {chatUnreadCount > 0 && (collapsed ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-slate-800" />
            ) : (
              <span className="ml-auto grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">{chatUnreadCount}</span>
            ))}
          </NavLink>
        )}
        {/* Approvals — items routed to this user by an approval workflow's current step. */}
        {!!user && !isGuest && (
          <NavLink to="/approvals" onClick={onNavigate} aria-label={pendingApprovals > 0 ? `Approvals — ${pendingApprovals} pending` : 'Approvals'} className={({ isActive }) => `relative ${cx(isActive)}`}>
            <Icon path={ICONS.approvals} /> {!collapsed && 'Approvals'}
            {pendingApprovals > 0 && (collapsed ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-slate-800" />
            ) : (
              <span className="ml-auto grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">{pendingApprovals}</span>
            ))}
          </NavLink>
        )}
        {/* Reports — PM status report (weekly/monthly); PMs run them, ADMIN/PMO oversee. A guest
            gets the same hub scoped to their own personal projects. */}
        {!!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'GUEST'].includes(user.role) && (
          <NavLink to="/reports" data-tour="nav-reports" onClick={onNavigate} aria-label={user.role === 'GUEST' ? 'My Reports' : 'Reports'} className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.reports} /> {!collapsed && (user.role === 'GUEST' ? 'My Reports' : 'Reports')}
          </NavLink>
        )}
        {/* Timesheet is for people who do task work — hide it for ADMIN/PMO (portfolio roles). */}
        {!!user && !['ADMIN', 'PMO'].includes(user.role) && (
          <NavLink to="/my-timesheet" onClick={onNavigate} aria-label="My Timesheet" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.clock} /> {!collapsed && 'My Timesheet'}
          </NavLink>
        )}
        {/* Resource Pool sits with the daily-work items — Finance & Guests use it too, so it's
            not an admin-only tool. */}
        {!!user && ['ADMIN', 'PMO', 'FINANCE', 'GUEST'].includes(user.role) && (
          <NavLink to="/admin/resources" onClick={onNavigate} aria-label={user.role === 'GUEST' ? 'My Resource Pool' : 'Resource Pool'} className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.resources} /> {!collapsed && (user.role === 'GUEST' ? 'My Resources' : 'Resource Pool')}
          </NavLink>
        )}
        {/* MANAGE — admin/PMO governance (project registry, users, audit). */}
        {isAdminPmo && (!collapsed
          ? <div className={sectionLabel}>Manage</div>
          : <div className="my-2 border-t border-white/10" />)}
        {isAdminPmo && (
          <NavLink to="/admin/projects" onClick={onNavigate} aria-label="Project Database" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.database} /> {!collapsed && 'Project Database'}
          </NavLink>
        )}
        {user?.role === 'ADMIN' && (
          <NavLink to="/admin/users" onClick={onNavigate} aria-label="Users" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.users} /> {!collapsed && 'Users'}
          </NavLink>
        )}
        {user?.role === 'ADMIN' && (
          <NavLink to="/admin/members" onClick={onNavigate} aria-label="Members" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.org} /> {!collapsed && 'Members'}
          </NavLink>
        )}
        {user?.role === 'ADMIN' && (
          <NavLink to="/admin/audit" onClick={onNavigate} aria-label="Audit trail" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.changeLog} /> {!collapsed && 'Audit trail'}
          </NavLink>
        )}
        {user?.role === 'ADMIN' && (
          <NavLink to="/admin/billing" onClick={onNavigate} aria-label="Billing & plan" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.billing} /> {!collapsed && 'Billing'}
          </NavLink>
        )}
        {/* PLATFORM — super-admin (isPlatformAdmin), transcends the active tenant: provision/suspend orgs. */}
        {user?.isPlatformAdmin && (!collapsed
          ? <div className={`${sectionLabel} ${platform ? 'text-violet-300/80' : ''}`}>Platform</div>
          : <div className={`my-2 border-t ${platform ? 'border-violet-400/20' : 'border-white/10'}`} />)}
        {user?.isPlatformAdmin && (
          <NavLink to="/admin/tenants" onClick={onNavigate} aria-label="Tenants (Platform)" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.tenants} /> {!collapsed && 'Tenants'}
          </NavLink>
        )}
        {user?.isPlatformAdmin && (
          <NavLink to="/admin/guests" onClick={onNavigate} aria-label="Guests (Platform)" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.users} /> {!collapsed && 'Guests'}
          </NavLink>
        )}
        {!collapsed && <div className={sectionLabel}>Projects</div>}
        {collapsed && <div className="my-2 border-t border-white/10" />}
        {/* Don't flash "No projects yet" while the list is still loading (looks like the
            projects vanished on a slow first paint). */}
        {!collapsed && projectsLoading && projects.length === 0 && <div className="px-3 py-1 text-xs text-slate-400">Loading…</div>}
        {!collapsed && !projectsLoading && projects.length === 0 && <div className="px-3 py-1 text-xs text-slate-400">No projects yet</div>}
        {visibleProjects.map((p) => (
          <NavLink key={p.id} to={`/projects/${p.id}`} onClick={onNavigate} aria-label={p.name} className={({ isActive }) => cx(isActive)}>
            {collapsed ? (
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white ${projectAccent(p.id).solid}`}>
                {p.name[0]?.toUpperCase() ?? '?'}
              </span>
            ) : (
              <>
                <span className={`h-2 w-2 shrink-0 rounded-full ${projectAccent(p.id).solid}`} />
                <span className="truncate">{p.name}</span>
              </>
            )}
          </NavLink>
        ))}
        {!collapsed && projects.length > CAP && (
          <button
            onClick={() => setShowAllProjects((s) => !s)}
            className="w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            {showAllProjects ? '▴ Show less' : `▾ Show all ${projects.length}`}
          </button>
        )}
      </nav>

      {/* Manual + Settings: drawer-only. On the web these sit in the header top-bar, so the
          fixed sidebar keeps its focus on Dashboard / Resources / Projects. */}
      {drawer && (
        <div className="space-y-1 border-t border-white/10 px-3 py-2">
          <NavLink to="/manual" onClick={onNavigate} aria-label="Manual" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.manual} /> {!collapsed && 'Manual'}
          </NavLink>
          <NavLink to="/settings" onClick={onNavigate} aria-label="Settings" className={({ isActive }) => cx(isActive)}>
            <Icon path={ICONS.settings} /> {!collapsed && 'Settings'}
          </NavLink>
        </div>
      )}

      {/* Profile footer doubles as the account menu (Settings / Manual / theme / Logout),
          opening upward so it clears the bottom of the viewport. */}
      <div className={`border-t border-white/10 py-2 ${collapsed ? 'flex justify-center px-2' : 'px-2'}`}>
        <AvatarMenu variant="row" direction="up" collapsed={collapsed} />
      </div>
      {collapsed && !drawer && tip && createPortal(
        <div
          style={{ top: tip.top }}
          className="pointer-events-none fixed left-16 z-[70] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10"
        >
          {tip.label}
        </div>,
        document.body,
      )}
    </div>
  );
}
