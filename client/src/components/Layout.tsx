import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { subscribePageTitle, getPageTitle } from '../lib/pageTitle';
import { useAuth } from '../context/AuthContext';
import { useLang, greet } from '../context/LanguageContext';
import { useOnboarding } from '../context/OnboardingContext';
import NotificationBell from './NotificationBell';
import Sidebar from './Sidebar';
import CommandPalette from './CommandPalette';
import MobileTabBar from './MobileTabBar';
import ChatWidget from './ChatWidget';
import AiAssistant from './AiAssistant';
import ChatNotifier from './ChatNotifier';
import ChatStream from './ChatStream';
import AvatarMenu from './AvatarMenu';
import InstallPrompt from './InstallPrompt';
import PageTransition from './PageTransition';
import ImpersonationBanner from './ImpersonationBanner';
import { SidebarContext, type SidebarContextValue } from '../context/SidebarContext';
import TrialBanner from './TrialBanner';
import UpgradeWall from './UpgradeWall';
import { isPlatformRoute } from '../lib/platformConsole';

export default function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const { start: startTour } = useOnboarding();
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname === '/';
  const path = location.pathname;
  const cards = location.search.includes('view=cards');
  const isGuest = user?.role === 'GUEST';
  // Platform "Control Plane" skin — active only on the super-admin routes (context, not account).
  const platform = !!user?.isPlatformAdmin && isPlatformRoute(path);
  // The greeting header (monday.com-style) is the Home dashboard only; the Projects-cards view and
  // every other page instead show their menu-name title in the top bar (e.g. a project detail → "Projects").
  const showGreeting = onHome && !cards;
  // The three bottom-nav destinations (Home, Projects-cards, Timesheet/Resources) never get a back arrow.
  const isBottomTab = onHome || path === '/my-timesheet' || path.startsWith('/admin/resources');
  const pageTitle = onHome
    ? (cards ? 'Projects' : '')
    : path.startsWith('/projects/') ? 'Projects'
    : path === '/reports' ? (isGuest ? 'My Reports' : 'Reports')
    : path === '/my-timesheet' ? 'Timesheet'
    : path.startsWith('/admin/resources') ? (isGuest ? 'My Resources' : 'Resources')
    : path === '/admin/users' ? 'Users'
    : path === '/admin/members' ? 'Members'
    : path === '/admin/audit' ? 'Audit trail'
    : path.startsWith('/admin/tenants') ? (id ? 'Konsol Platform' : 'Platform Console')
    : path.startsWith('/admin/guests') ? (id ? 'Akun Tamu' : 'Guest accounts')
    : path.startsWith('/admin/settings') ? (id ? 'Pengaturan Platform' : 'Platform settings')
    : path === '/settings' ? 'Settings'
    : path === '/manual' ? 'Manual'
    : path === '/notifications' ? (id ? 'Notifikasi' : 'Notifications')
    : '';
  // A page can publish a contextual mobile title (e.g. ProjectPage → the project name) that overrides
  // the generic route title above. Falls back to pageTitle when none is set.
  const titleOverride = useSyncExternalStore(subscribePageTitle, getPageTitle, () => null);
  const mobileTitle = titleOverride ?? pageTitle;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('prima_sidebar_collapsed') === '1');
  // Mirror `collapsed` in a ref so the stable auto-collapse callbacks can read the live value without
  // depending on it. `autoPrev` holds the state to restore while a temporary auto-collapse is active
  // (null = not auto-collapsing → the state is the user's own manual/default choice).
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);
  const autoPrev = useRef<boolean | null>(null);
  useEffect(() => {
    // Persist only genuine (manual/default) state — never the transient auto-collapse override, so a
    // page reload while on the Schedule tab doesn't bake the temporary collapse into the preference.
    if (autoPrev.current === null) localStorage.setItem('prima_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  const toggle = useCallback(() => { autoPrev.current = null; setCollapsed((c) => !c); }, []);
  const beginAuto = useCallback(() => {
    if (autoPrev.current === null) autoPrev.current = collapsedRef.current; // remember the real choice once
    setCollapsed(true);
  }, []);
  const endAuto = useCallback(() => {
    if (autoPrev.current === null) return; // a manual toggle cancelled the auto-collapse → leave it be
    const prev = autoPrev.current;
    autoPrev.current = null;
    setCollapsed(prev);
  }, []);
  const sidebarCtx = useMemo<SidebarContextValue>(() => ({ collapsed, toggle, beginAuto, endAuto }), [collapsed, toggle, beginAuto, endAuto]);
  // Global ⌘K / Ctrl-K opens the command palette.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <SidebarContext.Provider value={sidebarCtx}>
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 sm:bg-slate-100">
      {/* PROTOTYPE light-glass v2 ambient — a TOP-WEIGHTED, desaturated aurora: colour is concentrated
          behind the hero up top and fades to the clean neutral base lower down, so data lists sit on
          even ground (phones, light only). */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 block overflow-hidden dark:hidden md:hidden">
        <div className="absolute -right-10 -top-16 h-72 w-72 rounded-full bg-violet-300/55 blur-3xl" />
        <div className="absolute -left-16 -top-8 h-72 w-72 rounded-full bg-sky-300/50 blur-3xl" />
        <div className="absolute right-1/4 top-[10%] h-56 w-56 rounded-full bg-fuchsia-200/50 blur-3xl" />
        {/* fade the lower ~60% to the base so content below the hero reads on neutral ground */}
        <div className="absolute inset-x-0 top-[34%] bottom-0 bg-gradient-to-b from-transparent to-slate-50" />
      </div>
      {/* Mobile-only "Aurora Glass" ambient — soft violet/cyan blobs behind all content for depth
          (dark phones only; purely decorative, non-interactive). Matches the mobile-v2 design. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 hidden overflow-hidden dark:max-md:block">
        <div className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-sky-500/15 blur-3xl" />
      </div>
      {/* Sidebar — fixed column on md+ (collapsible to an icon rail), slide-over on mobile. */}
      <aside className="hidden md:block">
        <Sidebar collapsed={collapsed} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <Sidebar onNavigate={() => setMobileOpen(false)} drawer />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`z-10 flex shrink-0 items-center gap-2 border-b px-4 transition-colors duration-200 ${platform ? 'border-violet-400/20 bg-indigo-950 backdrop-blur-xl' : 'border-white/50 bg-white/55 backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_0_rgba(15,23,42,0.06),0_10px_24px_-20px_rgba(15,23,42,0.3)] dark:border-black/20 dark:bg-slate-800 dark:backdrop-blur-none dark:backdrop-saturate-100 dark:shadow-none sm:border-black/20 sm:bg-slate-800 sm:backdrop-blur-none sm:backdrop-saturate-100 sm:shadow-none'}`}
          style={{ height: 'calc(3.5rem + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}
        >
          {/* Phones: initials avatar (account/settings) sits top-left. */}
          <div className="md:hidden"><AvatarMenu /></div>
          {/* Phones, Home only: a monday.com-style greeting + full name. */}
          {showGreeting && (
            <div className="min-w-0 leading-tight md:hidden">
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">{greet(lang, new Date().getHours())}</div>
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-white">{user?.name}</div>
            </div>
          )}
          {/* Hamburger removed on phones — the bottom tab bar handles navigation there. Kept for md as a fallback. */}
          <button
            onClick={() => setMobileOpen(true)}
            className="hidden h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          {/* Back — appears on nested pages (not the primary bottom-nav destinations). */}
          {!isBottomTab && (
            <button
              onClick={() => navigate(-1)}
              aria-label="Back"
              title="Back"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white sm:text-slate-300 sm:hover:bg-white/10 sm:hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {/* Section title on every non-Home page (phones) — mirrors the menu name. */}
          {!showGreeting && mobileTitle && (
            <div className="min-w-0 truncate text-base font-semibold text-slate-800 dark:text-white md:hidden">{mobileTitle}</div>
          )}
          <button
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle sidebar"
            className="hidden h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white md:grid"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
          {/* Desktop: the current section name (mirrors the sidebar menu) so the top bar
              isn't a blank strip and users always know where they are. */}
          {pageTitle && (
            <div className="ml-1 hidden min-w-0 truncate text-base font-semibold text-white md:block">{pageTitle}</div>
          )}
          {/* Command palette trigger — pill on desktop, icon on mobile */}
          <button
            data-tour="search"
            onClick={() => setCmdOpen(true)}
            className="ml-1 hidden w-64 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition hover:border-white/25 hover:text-white sm:flex lg:w-80"
            title="Search & jump (Ctrl/⌘ K)"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <span className="flex-1 text-left">Search…</span>
            <kbd className="shrink-0 rounded border border-white/20 px-1 text-[10px] text-slate-300">⌘K</kbd>
          </button>
          <div className="flex-1" />
          <button
            data-tour="search"
            onClick={() => setCmdOpen(true)}
            aria-label="Search"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white sm:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          </button>
          <NotificationBell />
          {/* Guests can replay the getting-started tour anytime. */}
          {user?.role === 'GUEST' && (
            <button
              data-tour="tour-replay"
              onClick={startTour}
              title={lang === 'id' ? 'Panduan penggunaan' : 'Getting-started tour'}
              aria-label={lang === 'id' ? 'Panduan penggunaan' : 'Getting-started tour'}
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
            </button>
          )}
          {/* Desktop: Settings, Manual, admin links, theme + Logout all live in one avatar menu
              (declutters the top bar). Phones keep the top-left AvatarMenu above. */}
          <div className="ml-1 hidden md:block"><AvatarMenu align="right" /></div>
        </header>

        {/* Cross-tenant caution ribbon — the persistent "you are elevated" signal on platform routes. */}
        {platform && (
          <div className="flex items-center gap-2 border-b border-violet-400/20 bg-gradient-to-r from-indigo-950 via-indigo-900 to-violet-900 px-4 py-1.5 text-xs text-indigo-100">
            <span aria-hidden className="text-sm text-amber-300">⚠</span>
            <span className="min-w-0 truncate">
              <b className="font-semibold text-white">{id ? 'Konsol Platform' : 'Platform Console'}</b>
              {id
                ? <> — Anda beroperasi lintas <b>semua organisasi</b>. Tindakan di sini memengaruhi setiap tenant.</>
                : <> — you are operating across <b>all tenants</b>. Actions here affect every organization.</>}
            </span>
            {/* Identity chip — who is wielding this cross-tenant power. */}
            <span className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100 ring-1 ring-white/15 sm:inline-flex">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-300 motion-safe:animate-pulse" />
              {id ? 'Super Admin' : 'Super Admin'}{user?.name ? <span className="font-medium normal-case text-white/90"> · {user.name}</span> : null}
            </span>
          </div>
        )}
        <ImpersonationBanner />
        <TrialBanner />
        <UpgradeWall />
        {/* pb clears the fixed chat bubble (bottom-right, ~80px tall zone) so a table's last-row
            actions are never hidden behind it — see ChatWidget. */}
        <main className={`flex-1 overflow-y-auto overscroll-y-contain px-4 pb-28 pt-3 sm:px-6 sm:pt-6 md:pb-24 ${platform ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''}`}>
          <div className="mx-auto max-w-7xl"><PageTransition>{children}</PageTransition></div>
        </main>
      </div>

      <InstallPrompt />
      <ChatStream />
      <ChatNotifier />
      <ChatWidget />
      <AiAssistant />
      <MobileTabBar />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
    </SidebarContext.Provider>
  );
}
