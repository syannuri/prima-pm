import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { TOUR_STEPS, onboardedKey, tourSessionKey } from '../lib/onboarding';

type OnboardingValue = {
  active: boolean;
  index: number;
  total: number;
  start: () => void;          // (re)launch from step 0 — used by the replay button
  next: () => void;
  back: () => void;
  finish: () => void;         // completed → never auto-shows again
  skip: () => void;           // dismissed → also marks as seen
};

const OnboardingCtx = createContext<OnboardingValue | null>(null);

export function useOnboarding(): OnboardingValue {
  const ctx = useContext(OnboardingCtx);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const total = TOUR_STEPS.length;
  const autoRan = useRef(false);

  const start = useCallback(() => { setIndex(0); setActive(true); }, []);
  const next = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const end = useCallback((completed: boolean) => {
    setActive(false);
    if (!user) return;
    // Either way the guest has "seen" it, so it won't auto-open again on this device.
    localStorage.setItem(onboardedKey(user.id), '1');
    localStorage.removeItem(tourSessionKey(user.id));
    void completed;
  }, [user]);

  const finish = useCallback(() => end(true), [end]);
  const skip = useCallback(() => end(false), [end]);

  // Auto-start for a guest's first login (once per device); resume an interrupted run across
  // navigation/reload. Runs once when the user becomes known.
  useEffect(() => {
    if (!user || autoRan.current) return;
    if (user.role !== 'GUEST') return;
    autoRan.current = true;
    const resume = localStorage.getItem(tourSessionKey(user.id));
    if (resume !== null) {
      const i = Number.parseInt(resume, 10);
      setIndex(Number.isFinite(i) ? Math.max(0, Math.min(total - 1, i)) : 0);
      setActive(true);
      return;
    }
    if (!localStorage.getItem(onboardedKey(user.id))) {
      // Let the dashboard paint first so the "+ New Project" anchor exists to spotlight.
      const t = setTimeout(() => { setIndex(0); setActive(true); }, 900);
      return () => clearTimeout(t);
    }
  }, [user, total]);

  // Persist progress so a reload / route change mid-tour resumes on the same step.
  useEffect(() => {
    if (active && user) localStorage.setItem(tourSessionKey(user.id), String(index));
  }, [active, index, user]);

  return (
    <OnboardingCtx.Provider value={{ active, index, total, start, next, back, finish, skip }}>
      {children}
    </OnboardingCtx.Provider>
  );
}
