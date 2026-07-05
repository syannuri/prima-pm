import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Greeting/date language. Scope is intentionally small (greeting + date formatting),
// not a full app translation. Default is auto-detected from the browser; the user can
// override it in Settings (persisted to localStorage).
export type Lang = 'id' | 'en';
const KEY = 'prima_lang';

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'id' || stored === 'en') return stored;
    const nav = (navigator.language || '').toLowerCase();
    return nav.startsWith('id') ? 'id' : 'en';
  } catch {
    return 'en';
  }
}

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}
const LanguageContext = createContext<LangState | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectLang);
  useEffect(() => {
    localStorage.setItem(KEY, lang);
    // Keep the document language in sync so screen readers / crawlers see the
    // right locale (the static index.html only ever declares `lang="en"`).
    document.documentElement.lang = lang;
  }, [lang]);
  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used within a LanguageProvider');
  return ctx;
}

// Time-of-day greeting in the chosen language.
export function greet(lang: Lang, hour: number): string {
  if (lang === 'id') {
    if (hour < 11) return 'Selamat pagi';
    if (hour < 15) return 'Selamat siang';
    if (hour < 19) return 'Selamat sore';
    return 'Selamat malam';
  }
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export const dateLocale = (lang: Lang) => (lang === 'id' ? 'id-ID' : 'en-GB');
