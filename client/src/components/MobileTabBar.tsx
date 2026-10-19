import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { useNotificationCount } from '../hooks/useNotificationCount';
import { haptic } from '../lib/haptics';
import { openAnett } from '../lib/anettBus';
import { api } from '../api/client';

// SF-Symbol-style icon pairs: a thin outline for the unselected state and a solid glyph for
// the selected one — iOS swaps outline→filled on select (this is the signature iPhone tab-bar
// look), rather than drawing a Material-style pill behind the active icon.
const HOME = 'M3 9.5 12 3l9 6.5M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9';
const HOME_F = 'M11.3 3.3 3.3 10c-.2.2-.3.4-.3.7V20a1 1 0 0 0 1 1h4.2v-5.3a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1V21H19a1 1 0 0 0 1-1v-9.3c0-.3-.1-.5-.3-.7l-8-6.7a1 1 0 0 0-1.4 0z';
const FOLDER = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const FOLDER_F = 'M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.4.6l1 1a2 2 0 0 0 1.4.6H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const PEOPLE = 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM21 21v-2a4 4 0 0 0-3-3.87';
const PEOPLE_F = 'M16 4.2a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zM8.3 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.3 13c-3.2 0-6.3 1.9-6.3 4.6V19a1 1 0 0 0 1 1h10.6a1 1 0 0 0 1-1v-1.4C14.6 14.9 11.5 13 8.3 13zM16.7 12.6c1.8.8 3.3 2.4 3.3 4.6V19c0 .4-.1.7-.2 1H21a1 1 0 0 0 1-1v-1.3c0-2.5-2.6-4.2-5.3-4.1z';
const CLOCK = 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';
const CLOCK_F = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM11.3 6.3h1.4V12h-1.4zM12 11.3h5v1.4h-5z';
// Bar-chart glyph for Reports (same path reads well as outlined rects when inactive, filled bars when active).
const CHART = 'M4 13h3v7H4zM10.5 4h3v16h-3zM17 9h3v11h-3z';
// 4-point sparkle for the Anett FAB (Anett's prism identity, matching the prototype's centre action).
const SPARK = 'M12 3c.4 3.6 2.4 5.6 6 6-3.6.4-5.6 2.4-6 6-.4-3.6-2.4-5.6-6-6 3.6-.4 5.6-2.4 6-6z';

// iOS-style bottom tab bar (phones only). Five destinations with a raised centre action, per the
// Mobile v2 prototype: Home · Projects · [Anett ✦ FAB] · Reports · Team. The centre FAB opens the
// Anett AI assistant when it's available, and otherwise falls back to "New project" so it is never a
// dead control (AI is dormant unless a tenant enables it). The last tab is role-adaptive: portfolio
// roles & guests get the Resources pool, delivery staff get their Timesheet — each avoids a 403.
export default function MobileTabBar() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const notifCount = useNotificationCount();
  const cards = loc.search.includes('view=cards');
  const isPortfolio = !!user && ['ADMIN', 'PMO', 'FINANCE'].includes(user.role);
  const isGuest = user?.role === 'GUEST';
  // Reactive AI availability (shared query key — react-query dedupes with the AiAssistant mount).
  const availQ = useQuery({ queryKey: ['assistant-available'], queryFn: () => api.get<{ aiAvailable: boolean }>(`/assistant/available`), staleTime: 60_000 });
  const aiOn = availQ.data?.aiAvailable === true;

  const team = isPortfolio || isGuest
    ? { to: '/admin/resources', label: id ? 'Tim' : 'Team', icon: PEOPLE, iconFill: PEOPLE_F, active: loc.pathname.startsWith('/admin/resources') }
    : { to: '/my-timesheet', label: 'Timesheet', icon: CLOCK, iconFill: CLOCK_F, active: loc.pathname.startsWith('/my-timesheet') };

  const tabs = [
    // Home carries the notification badge — the dashboard is where you act on alerts.
    { to: '/', label: 'Home', icon: HOME, iconFill: HOME_F, active: loc.pathname === '/' && !cards, badge: notifCount },
    { to: '/?view=cards', label: id ? 'Proyek' : 'Projects', icon: FOLDER, iconFill: FOLDER_F, active: loc.pathname === '/' && cards, badge: 0 },
    { to: '/reports', label: id ? 'Laporan' : 'Reports', icon: CHART, iconFill: CHART, active: loc.pathname.startsWith('/reports'), badge: 0 },
    { ...team, badge: 0 },
  ];
  // Split 2 | FAB | 2 around the raised centre action.
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  const onFab = () => { haptic(); if (aiOn) openAnett(); else navigate('/?new=1'); };

  return (
    <nav
      className="m-tabbar fixed inset-x-3 z-30 grid grid-cols-5 items-end rounded-[26px] border border-white/10 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.7)] md:hidden"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      aria-label="Primary"
    >
      {left.map((t) => <TabItem key={t.label} t={t} />)}

      {/* Centre FAB — the Anett AI assistant (prototype's prism ✦), seated in the middle of the bar. */}
      <div className="flex items-center justify-center self-stretch">
        <button
          onClick={onFab}
          aria-label={aiOn ? 'Anett AI Assistant' : (id ? 'Proyek baru' : 'New project')}
          title={aiOn ? 'Anett AI Assistant' : (id ? 'Proyek baru' : 'New project')}
          className="relative grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-sky-400 text-white shadow-lg shadow-violet-600/40 ring-1 ring-white/30 transition-transform duration-150 ease-out active:scale-90"
        >
          <span aria-hidden className="pointer-events-none absolute inset-x-1.5 top-1 h-1/2 rounded-[12px] bg-gradient-to-b from-white/45 to-transparent" />
          <svg viewBox="0 0 24 24" className="relative h-7 w-7 drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]" fill="currentColor"><path d={SPARK} /></svg>
        </button>
      </div>

      {right.map((t) => <TabItem key={t.label} t={t} />)}
    </nav>
  );
}

function TabItem({ t }: { t: { to: string; label: string; icon: string; iconFill: string; active: boolean; badge: number } }) {
  return (
    <Link
      to={t.to}
      onClick={() => haptic()}
      aria-current={t.active ? 'page' : undefined}
      className={`group relative flex select-none flex-col items-center gap-1 py-2.5 transition-colors ${t.active ? 'text-white' : 'text-slate-400'}`}
    >
      {/* Soft radial gradient glow behind the active icon (replaces the flat iOS tint). */}
      <span className={`relative grid place-items-center ${t.active ? 'm-tab-glow' : ''}`}>
        {/* Filled glyph when selected; thin outline otherwise. A violet→cyan drop-shadow
            makes the active icon glow; a tiny press-scale is the touch feedback. */}
        <svg
          viewBox="0 0 24 24"
          className={`relative z-[1] h-[26px] w-[26px] transition-transform duration-150 ease-out group-active:scale-90 ${t.active ? 'drop-shadow-[0_0_10px_rgba(139,92,246,0.9)]' : ''}`}
          fill={t.active ? 'url(#mtab-grad)' : 'none'}
          stroke={t.active ? 'none' : 'currentColor'}
          strokeWidth={t.active ? undefined : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {t.active && (
            <defs>
              <linearGradient id="mtab-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#a78bfa" /><stop offset="0.5" stopColor="#818cf8" /><stop offset="1" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
          )}
          <path d={t.active ? t.iconFill : t.icon} fillRule={t.active ? 'evenodd' : undefined} clipRule={t.active ? 'evenodd' : undefined} />
        </svg>
        {t.badge > 0 && (
          <span className="absolute -right-2 -top-1 z-10 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-slate-900">
            {t.badge > 9 ? '9+' : t.badge}
          </span>
        )}
      </span>
      <span className={`text-[10px] leading-none transition-transform duration-150 ease-out group-active:scale-95 ${t.active ? 'font-semibold' : 'font-medium'}`}>{t.label}</span>
    </Link>
  );
}
