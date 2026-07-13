import { useState } from 'react';
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
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  install: 'M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
};

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

// Round user-initials button (top-right) that opens an account/settings sheet — the mobile
// home for Settings, Manual and Logout (replacing the separate header buttons).
export default function AvatarMenu() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const { lang } = useLang();
  const id = lang === 'id';
  const { canInstall, promptInstall } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // Labels follow the selected language (like the dashboard) so the account
  // menu isn't a half-English/half-Indonesian mix when the toggle is flipped.
  const t = {
    account: id ? 'Akun & pengaturan' : 'Account & settings',
    settings: id ? 'Pengaturan' : 'Settings',
    manual: id ? 'Panduan & bantuan' : 'Manual & help',
    users: id ? 'Pengguna' : 'Users',
    install: id ? 'Pasang aplikasi' : 'Install app',
    light: id ? 'Mode terang' : 'Light mode',
    darkMode: id ? 'Mode gelap' : 'Dark mode',
    logout: id ? 'Keluar' : 'Logout',
  };
  const itemCls = 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t.account}
        className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-xs font-bold text-white shadow-sm ring-1 ring-black/5 transition active:scale-95"
      >
        {initials(user?.name)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={close} />
          <div className="absolute left-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-sm font-bold text-white">{initials(user?.name)}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{user?.name}</div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</div>
              </div>
            </div>
            <nav className="p-1.5 text-sm">
              <Link to="/settings" onClick={close} className={itemCls}><Ico d={I.gear} /> {t.settings}</Link>
              <Link to="/manual" onClick={close} className={itemCls}><Ico d={I.help} /> {t.manual}</Link>
              {user?.role === 'ADMIN' && <Link to="/admin/users" onClick={close} className={itemCls}><Ico d={I.users} /> {t.users}</Link>}
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
        </>
      )}
    </div>
  );
}
