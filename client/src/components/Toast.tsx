import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Lightweight, dependency-free toast system. ToastProvider holds a stack of
// transient messages; useToast() returns helpers to push them. Rendered via a
// portal so toasts float above modals/overlays (z-[60] > Modal's z-50).

type ToastKind = 'success' | 'error' | 'info';

type Toast = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  show: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DURATION_MS = 4500;

const STYLE: Record<ToastKind, { ring: string; icon: string; label: string }> = {
  success: { ring: 'border-emerald-500/40', icon: '✓', label: 'Success' },
  error: { ring: 'border-red-500/40', icon: '✕', label: 'Error' },
  info: { ring: 'border-brand-500/40', icon: 'ℹ', label: 'Info' },
};

const ICON_COLOR: Record<ToastKind, string> = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-brand-500',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, kind, message }]);
      timers.current[id] = setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  // Clear any pending timers on unmount.
  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  const api = useRef<ToastApi>({
    show,
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    info: (m) => show('info', m),
  });
  // Keep closures fresh (show is stable, but be safe).
  api.current = {
    show,
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    info: (m) => show('info', m),
  };

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6" style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}>
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className={`prima-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border ${STYLE[t.kind].ring} bg-white px-4 py-3 shadow-lg dark:bg-slate-800`}
            >
              <span className={`mt-0.5 text-sm font-bold ${ICON_COLOR[t.kind]}`} aria-hidden="true">
                {STYLE[t.kind].icon}
              </span>
              <p className="flex-1 break-words text-sm text-slate-700 dark:text-slate-200">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
