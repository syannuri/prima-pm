import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
// v2: light is the default on DESKTOP. Bumped from 'prima_theme' because the old provider
// auto-persisted the (then dark) default on every visit, so stored values were unreliable noise.
const KEY = 'prima_theme_v2';
// Phones default to DARK but can opt in to light via a per-device preference (set from the
// Appearance toggle). Separate from the desktop key so the two never clobber each other.
// Mirrors the inline boot script in index.html so there's no first-paint flash.
const KEY_M = 'prima_mobile_theme';
const MOBILE_Q = '(max-width: 639px)';
function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_Q).matches;
}

interface ThemeState {
  theme: Theme;    // the EFFECTIVE theme (desktop preference, or the mobile preference on phones)
  toggle: () => void;
  locked: boolean; // kept for API stability; false now that phones are toggleable
}
const ThemeContext = createContext<ThemeState | undefined>(undefined);

// The user's stored DESKTOP preference (phones use storedMobileTheme instead).
function storedTheme(): Theme {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'dark') return 'dark';
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') && !isMobileViewport()) return 'dark';
  return 'light';
}

// The per-device MOBILE preference — defaults to dark (phones stay dark unless opted in).
function storedMobileTheme(): Theme {
  return typeof localStorage !== 'undefined' && localStorage.getItem(KEY_M) === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);             // desktop preference
  const [mobileTheme, setMobileTheme] = useState<Theme>(storedMobileTheme); // per-device phone preference
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

  // Phones follow their own per-device preference (default dark); desktop follows `theme`.
  const effective: Theme = mobile ? mobileTheme : theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', effective === 'dark');
  }, [effective]);

  const toggle = () => {
    if (mobile) {
      setMobileTheme((t) => {
        const next: Theme = t === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY_M, next); } catch { /* ignore */ }
        return next;
      });
      return;
    }
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
      return next;
    });
  };
  return <ThemeContext.Provider value={{ theme: effective, toggle, locked: false }}>{children}</ThemeContext.Provider>;
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
