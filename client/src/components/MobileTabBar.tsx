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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/80 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-slate-900/75 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      {/* Scrim above the bar: fades scrolling content into it so nothing reads
          through the frosted glass (iOS-style). Sits just above the nav's top edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-950" />
      <div className="grid grid-cols-3">
        {tabs.map((t) => (
          <Link
            key={t.label}
            to={t.to}
            onClick={() => haptic()}
            aria-current={t.active ? 'page' : undefined}
            className={`group relative flex select-none flex-col items-center gap-1 pb-1.5 pt-2 transition-colors ${t.active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500'}`}
          >
            <span className="relative grid place-items-center">
              {/* iOS shows the filled glyph when selected; the outline (thin stroke) otherwise.
                  A tiny press-scale is the only touch feedback — no Material pill behind it. */}
              <svg
                viewBox="0 0 24 24"
                className="h-[26px] w-[26px] transition-transform duration-150 ease-out group-active:scale-90"
                fill={t.active ? 'currentColor' : 'none'}
                stroke={t.active ? 'none' : 'currentColor'}
                strokeWidth={t.active ? undefined : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={t.active ? t.iconFill : t.icon} fillRule={t.active ? 'evenodd' : undefined} clipRule={t.active ? 'evenodd' : undefined} />
              </svg>
              {t.badge > 0 && (
                <span className="absolute -right-2 -top-1 z-10 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-slate-900">
                  {t.badge > 9 ? '9+' : t.badge}
                </span>
              )}
            </span>
            <span className={`text-[10px] leading-none transition-transform duration-150 ease-out group-active:scale-95 ${t.active ? 'font-semibold' : 'font-medium'}`}>{t.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
