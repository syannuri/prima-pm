import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotificationCount } from '../hooks/useNotificationCount';
import { haptic } from '../lib/haptics';

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
// filled disc with the hands cut out via evenodd (reads as a clock, not a plain dot).
const CLOCK_F = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM11.3 6.3h1.4V12h-1.4zM12 11.3h5v1.4h-5z';

// iOS-style bottom tab bar (phones only). Three glanceable destinations.
// The third tab is role-adaptive: portfolio roles get the corporate Resources pool, a guest
// gets their OWN private pool, and delivery staff (PM/member) get their Timesheet — each avoids
// a destination that would 403 for that role.
export default function MobileTabBar() {
  const loc = useLocation();
  const { user } = useAuth();
  const notifCount = useNotificationCount();
  const cards = loc.search.includes('view=cards');
  const isPortfolio = !!user && ['ADMIN', 'PMO', 'FINANCE'].includes(user.role);
  const isGuest = user?.role === 'GUEST';
  const third = isPortfolio || isGuest
    ? { to: '/admin/resources', label: isGuest ? 'My Resources' : 'Resources', icon: PEOPLE, iconFill: PEOPLE_F, active: loc.pathname.startsWith('/admin/resources') }
    : { to: '/my-timesheet', label: 'Timesheet', icon: CLOCK, iconFill: CLOCK_F, active: loc.pathname.startsWith('/my-timesheet') };
  const tabs = [
    // Home carries the notification badge — the dashboard is where you act on alerts.
    { to: '/', label: 'Home', icon: HOME, iconFill: HOME_F, active: loc.pathname === '/' && !cards, badge: notifCount },
    { to: '/?view=cards', label: 'Projects', icon: FOLDER, iconFill: FOLDER_F, active: loc.pathname === '/' && cards, badge: 0 },
    { ...third, badge: 0 },
  ];
  return (
    <nav
      className="m-tabbar fixed inset-x-3 z-30 grid grid-cols-3 rounded-[26px] border border-white/10 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.7)] md:hidden"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      aria-label="Primary"
    >
      {tabs.map((t) => (
        <Link
          key={t.label}
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
      ))}
    </nav>
  );
}
