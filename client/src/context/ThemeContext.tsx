import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
// v2: light is the default on DESKTOP. Bumped from 'prima_theme' because the old provider
// auto-persisted the (then dark) default on every visit, so stored values were unreliable noise.
const KEY = 'prima_theme_v2';
// PHONES ARE ALWAYS DARK (product decision) — light mode is a desktop-only option. Mirrors the
// inline boot script in index.html so there's no first-paint flash.
const MOBILE_Q = '(max-width: 639px)';
function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_Q).matches;
}

interface ThemeState {
  theme: Theme;    // the EFFECTIVE theme (always 'dark' on mobile)
  toggle: () => void;
  locked: boolean; // true on mobile → theme is forced dark; the toggle is a no-op / hidden
}
const ThemeContext = createContext<ThemeState | undefined>(undefined);

// The user's stored DESKTOP preference (ignored on mobile, which is always dark).
function storedTheme(): Theme {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'dark') return 'dark';
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') && !isMobileViewport()) return 'dark';
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme); // desktop preference
  const [mobile, setMobile] = useState<boolean>(isMobileViewport);

  // Track viewport so a desktop↔mobile resize re-applies the right theme live.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_Q);
    const on = () => setMobile(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, []);

  // PROTOTYPE: a localStorage opt-in (`prima_mobile_light=1`) lets phones use light mode so the
  // light-mode design can be evaluated. Without the flag, phones stay forced-dark as before.
  const mobileLightPreview = typeof localStorage !== 'undefined' && localStorage.getItem('prima_mobile_light') === '1';
  const effective: Theme = mobile && !mobileLightPreview ? 'dark' : theme; // mobile is forced dark unless the preview flag is set
  useEffect(() => {
    document.documentElement.classList.toggle('dark', effective === 'dark');
  }, [effective]);

  const toggle = () => {
    if (mobile) return; // light mode is desktop-only
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
      return next;
    });
  };
  return <ThemeContext.Provider value={{ theme: effective, toggle, locked: mobile }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

// Sun / moon toggle button.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle, locked } = useTheme();
  if (locked) return null; // phones are dark-only — no light/dark toggle
  const dark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
      className={`grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${className}`}
    >
      {dark ? (
        // sun
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // moon
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
