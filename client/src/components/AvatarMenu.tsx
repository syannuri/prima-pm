import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLang } from '../context/LanguageContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

const initials = (name?: string) =>
  (name ?? '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || 'U';

const I = {
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.5 9a2.5 2.5 0 0 1 4.86.83c0 1.67-2.5 2.5-2.5 2.5M12 17h.01',
  users: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM21 21v-2a4 4 0 0 0-3-3.87',
  audit: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12l2 2 4-4',
  reports: 'M3 3v18h18M7 15v3M12 11v7M17 7v11',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  install: 'M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  caretV: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  org: 'M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M14 9h.01M10 13h.01M14 13h.01M10 17h.01M14 17h.01',
  check: 'M20 6 9 17l-5-5',
};

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

// User button that opens an account/settings sheet — the home for Settings, Manual, admin
// links and Logout (replacing the separate header buttons). `variant="avatar"` is the round
// initials button (phones top-left, desktop top bar); `variant="row"` is a full-width profile
// row (avatar + name + role) used in the sidebar footer, where the menu opens upward
// (direction="up"). `align` picks which edge the dropdown hangs from.
export default function AvatarMenu({
  align = 'left',
  direction = 'down',
  variant = 'avatar',
  collapsed = false,
}: {
  align?: 'left' | 'right';
  direction?: 'up' | 'down';
  variant?: 'avatar' | 'row';
  collapsed?: boolean;
}) {
  const { user, logout, tenants, activeTenantId, switchTenant } = useAuth();
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const { lang } = useLang();
  const id = lang === 'id';
  const { canInstall, promptInstall } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // The dropdown is PORTALED to <body> so it escapes the app-shell stacking context — the fixed
  // bottom tab bar (its own backdrop-blur context) otherwise painted OVER the menu no matter its
  // z-index. Portaled + z-50 it sits in the root layer, reliably above the tab bar. Position is
  // computed as fixed coords from the trigger's rect (anchored to whichever edge/direction).
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const gap = 8, W = 240, m = 8; // w-60 = 240px
    const vw = window.innerWidth, vh = window.innerHeight;
    const s: CSSProperties = { position: 'fixed' };
    if (align === 'right') s.right = Math.max(m, vw - r.right);
    else s.left = Math.min(Math.max(m, r.left), Math.max(m, vw - W - m));
    if (direction === 'up') { s.bottom = vh - r.top + gap; s.maxHeight = r.top - gap - m; }
    else { s.top = r.bottom + gap; s.maxHeight = vh - (r.bottom + gap) - m; }
    setPos(s);
  }, [open, align, direction]);
  // Keyboard dismissal + close on resize/orientation change (the fixed position would go stale).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open]);
  // Labels follow the selected language (like the dashboard) so the account
  // menu isn't a half-English/half-Indonesian mix when the toggle is flipped.
  const t = {
    account: id ? 'Akun & pengaturan' : 'Account & settings',
    settings: id ? 'Pengaturan' : 'Settings',
    manual: id ? 'Panduan & bantuan' : 'Manual & help',
    users: id ? 'Pengguna' : 'Users',
    audit: id ? 'Jejak audit' : 'Audit trail',
    myResources: id ? 'Resource Saya' : 'My Resources',
    myReports: id ? 'Laporan Saya' : 'My Reports',
    install: id ? 'Pasang aplikasi' : 'Install app',
    light: id ? 'Mode terang' : 'Light mode',
    darkMode: id ? 'Mode gelap' : 'Dark mode',
    logout: id ? 'Keluar' : 'Logout',
  };
  const itemCls = 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

  // The round-avatar dot, shared by both trigger variants.
  const avatarDot = (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-xs font-bold text-white shadow-sm ring-1 ring-black/5">
      {initials(user?.name)}
    </span>
  );

  return (
    <div className={`relative ${variant === 'row' && !collapsed ? 'w-full' : ''}`}>
      {variant === 'row' && !collapsed ? (
        <button
          ref={btnRef}
          onClick={() => setOpen((o) => !o)}
          aria-label={t.account}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
        >
          {avatarDot}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">{user?.name}</span>
            <span className="block truncate text-xs text-slate-400">{user?.role}</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={I.caretV} /></svg>
        </button>
      ) : (
        <button
          ref={btnRef}
          onClick={() => setOpen((o) => !o)}
          aria-label={t.account}
          aria-haspopup="menu"
          aria-expanded={open}
          className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-xs font-bold text-white shadow-sm ring-1 ring-black/5 transition active:scale-95"
        >
          {initials(user?.name)}
        </button>
      )}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={close} />
          {/* Portaled to <body> + fixed coords (see btnRef effect) so it escapes the app-shell
              stacking context and sits above the bottom tab bar. maxHeight (from the effect) keeps
              it on-screen; it scrolls internally when the menu is taller than the space. */}
          <div style={pos} className="z-[61] w-60 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-sm font-bold text-white">{initials(user?.name)}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{user?.name}</div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</div>
              </div>
            </div>
            {/* Tenant switcher — only when the user belongs to more than one org (hidden entirely
                in single-tenant / enforcement-off deployments). */}
            {tenants.length > 1 && (
              <div className="border-b border-slate-100 p-1.5 dark:border-slate-800">
                <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{id ? 'Organisasi' : 'Organization'}</div>
                {tenants.map((tn) => {
                  const active = tn.id === activeTenantId;
                  return (
                    <button
                      key={tn.id}
                      onClick={() => { if (!active) { close(); void switchTenant(tn.id); } }}
                      disabled={active}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${active ? 'font-semibold text-brand-600 dark:text-brand-400' : 'text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                    >
                      <span className="flex min-w-0 items-center gap-2"><Ico d={I.org} /><span className="truncate">{tn.name}</span></span>
                      {active && <Ico d={I.check} />}
                    </button>
                  );
                })}
              </div>
            )}
            <nav className="p-1.5 text-sm">
              <Link to="/settings" onClick={close} className={itemCls}><Ico d={I.gear} /> {t.settings}</Link>
              <Link to="/manual" onClick={close} className={itemCls}><Ico d={I.help} /> {t.manual}</Link>
              {user?.role === 'ADMIN' && <Link to="/admin/users" onClick={close} className={itemCls}><Ico d={I.users} /> {t.users}</Link>}
              {user?.role === 'ADMIN' && <Link to="/admin/members" onClick={close} className={itemCls}><Ico d={I.org} /> {id ? 'Anggota' : 'Members'}</Link>}
              {user?.role === 'ADMIN' && <Link to="/admin/audit" onClick={close} className={itemCls}><Ico d={I.audit} /> {t.audit}</Link>}
              {/* A guest's private Resource Pool — the hamburger drawer is gone on phones, so surface
                  it here in the reachable account menu (alongside the bottom tab bar + dashboard tile). */}
              {user?.role === 'GUEST' && <Link to="/reports" onClick={close} className={itemCls}><Ico d={I.reports} /> {t.myReports}</Link>}
              {user?.role === 'GUEST' && <Link to="/admin/resources" onClick={close} className={itemCls}><Ico d={I.users} /> {t.myResources}</Link>}
              {canInstall && (
                <button onClick={() => { close(); promptInstall(); }} className={`w-full ${itemCls}`}><Ico d={I.install} /> {t.install}</button>
              )}
              {/* Theme toggle — stays open so the change is visible and reversible in place. */}
              <button onClick={toggle} className={`w-full justify-between ${itemCls}`}>
                <span className="flex items-center gap-3"><Ico d={dark ? I.sun : I.moon} /> {dark ? t.light : t.darkMode}</span>
                <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${dark ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${dark ? 'left-[1.125rem]' : 'left-0.5'}`} />
                </span>
              </button>
            </nav>
            <div className="border-t border-slate-100 p-1.5 dark:border-slate-800">
              <button onClick={() => { close(); logout(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"><Ico d={I.logout} /> {t.logout}</button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
