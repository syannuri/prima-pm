import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotificationCount } from '../hooks/useNotificationCount';
import { haptic } from '../lib/haptics';

const HOME = 'M3 9.5 12 3l9 6.5M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9';
const FOLDER = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const PEOPLE = 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM21 21v-2a4 4 0 0 0-3-3.87';
const CLOCK = 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';

// iOS-style bottom tab bar (phones only). Three glanceable destinations.
// The third tab is role-adaptive: portfolio roles get Resources; delivery
// staff (PM/member) get their Timesheet — /admin/resources would 403 for them.
export default function MobileTabBar() {
  const loc = useLocation();
  const { user } = useAuth();
  const notifCount = useNotificationCount();
  const cards = loc.search.includes('view=cards');
  const isPortfolio = !!user && ['ADMIN', 'PMO', 'FINANCE'].includes(user.role);
  const third = isPortfolio
    ? { to: '/admin/resources', label: 'Resources', icon: PEOPLE, active: loc.pathname.startsWith('/admin/resources') }
    : { to: '/my-timesheet', label: 'Timesheet', icon: CLOCK, active: loc.pathname.startsWith('/my-timesheet') };
  const tabs = [
    // Home carries the notification badge — the dashboard is where you act on alerts.
    { to: '/', label: 'Home', icon: HOME, active: loc.pathname === '/' && !cards, badge: notifCount },
    { to: '/?view=cards', label: 'Projects', icon: FOLDER, active: loc.pathname === '/' && cards, badge: 0 },
    { ...third, badge: 0 },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/60 bg-white/60 backdrop-blur-2xl backdrop-saturate-150 dark:border-slate-700/50 dark:bg-slate-900/55 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-3">
        {tabs.map((t) => (
          <Link key={t.label} to={t.to} onClick={() => haptic()} className={`group relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${t.active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}>
            <span className="relative grid place-items-center">
              {/* iOS-style touch highlight — springs in on press, held while the tab is active. */}
              <span
                aria-hidden
                className={`pointer-events-none absolute -inset-x-3.5 -inset-y-1.5 rounded-2xl bg-brand-500/10 transition-all duration-200 ease-out dark:bg-brand-400/15 ${t.active ? 'scale-100 opacity-100' : 'scale-50 opacity-0 group-active:scale-100 group-active:opacity-100'}`}
              />
              <svg viewBox="0 0 24 24" className="relative h-6 w-6 transition-transform duration-150 ease-out group-active:scale-90" fill="none" stroke="currentColor" strokeWidth={t.active ? 2.4 : 1.9} strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
              {t.badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 z-10 grid h-4 min-w-[1rem] place-items-center rounded-full bg-slate-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:bg-slate-600 dark:ring-slate-900">
                  {t.badge > 9 ? '9+' : t.badge}
                </span>
              )}
            </span>
            <span className="relative transition-transform duration-150 ease-out group-active:scale-95">{t.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
