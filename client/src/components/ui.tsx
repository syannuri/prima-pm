import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../context/LanguageContext';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900 dark:shadow-lg dark:shadow-black/20 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{children}</h2>
      {sub && <p className="text-sm text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; 'data-tour'?: string }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300 dark:disabled:bg-slate-700',
    secondary:
      'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children, hint, required, error }: { label: string; children: ReactNode; hint?: string; required?: boolean; error?: string }) {
  const { lang } = useLang();
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden> *</span>}
        {required && <span className="ml-1 text-xs font-normal text-slate-400 dark:text-slate-500">{lang === 'id' ? '(wajib diisi)' : '(required)'}</span>}
      </span>
      {children}
      {/* A validation warning replaces the neutral hint when present. */}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-500">⚠ {error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
      )}
    </label>
  );
}

// text-base (16px) on mobile prevents iOS Safari from auto-zooming when a field is focused
// (it zooms any control whose font-size is < 16px and never zooms back — the page then reads
// as "not fitting the screen"). Desktop keeps the tighter text-sm (14px) at sm: and up.
const inputBase =
  'w-full rounded-lg border bg-white px-3 py-2 text-base sm:text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-1 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500';
// Border/ring colour reflects live validation: neutral until touched, green when the
// value matches its required format, red when it's present but malformed.
const inputBorder = {
  none: 'border-slate-300 focus:border-brand-500 focus:ring-brand-500 dark:border-slate-700',
  valid: 'border-green-500 focus:border-green-500 focus:ring-green-500 dark:border-green-600',
  invalid: 'border-red-400 focus:border-red-400 focus:ring-red-400 dark:border-red-500',
} as const;

export type InputState = keyof typeof inputBorder;

export function Input({ state = 'none', className, ...props }: InputHTMLAttributes<HTMLInputElement> & { state?: InputState }) {
  // Native browser spellcheck on by default (English prose fields get red-underline
  // suggestions). Callers pass spellCheck={false} for codes/emails/numeric fields.
  return <input className={`${inputBase} ${inputBorder[state]} ${className ?? ''}`} spellCheck {...props} />;
}

// Money field that displays Indonesian thousand separators ("1.204.500.000") while
// storing a plain digit string. `value` is the raw digits (empty allowed); the parent
// keeps doing Number(value) on submit. Uses a text input because <input type="number">
// never renders grouping separators.
export function MoneyInput({
  value,
  onValueChange,
  ...rest
}: { value: string; onValueChange: (raw: string) => void; state?: InputState } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const digits = String(value ?? '').split('.')[0].replace(/\D/g, '');
  const display = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      spellCheck={false}
      value={display}
      onChange={(e) => onValueChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}
export function Textarea({ state = 'none', className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { state?: InputState }) {
  return <textarea className={`${inputBase} ${inputBorder[state]} ${className ?? ''}`} rows={3} spellCheck {...props} />;
}
// Native <select>s render inconsistently across platforms (a grey OS control on mobile
// that ignores the dark theme). appearance-none forces our own styled box; a custom chevron
// replaces the native arrow. The caller's className goes on the wrapper so responsive width
// (e.g. w-full sm:w-auto) still works; the <select> fills it.
export function Select({ state = 'none', className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { state?: InputState }) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <select className={`${inputBase} ${inputBorder[state]} cursor-pointer appearance-none pr-9`} {...props} />
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export function Badge({ children, color = 'slate' }: { children: ReactNode; color?: string }) {
  const map: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    // Brand coral — reserved for positive/brand states (e.g. a closed project).
    coral: 'bg-brand-100 text-brand-700 dark:bg-brand-600/25 dark:text-brand-100',
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[color] ?? map.slate}`}>{children}</span>;
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 dark:border-slate-700 dark:border-t-brand-500" />;
}

// Animated placeholder block for loading (skeleton) states.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/70 dark:bg-slate-700/40 ${className}`} />;
}

// Friendly empty state: an icon bubble, a title, an optional hint and an optional action.
// Default glyph (an inbox) so every empty state has a warm visual anchor even when no icon is passed.
const EMPTY_ICON = 'M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z';

export function EmptyState({ icon, title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3.5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-400 ring-1 ring-brand-100 dark:bg-brand-900/25 dark:text-brand-300/80 dark:ring-brand-800/50">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon ?? EMPTY_ICON} />
        </svg>
      </div>
      <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Accessible on/off switch (role="switch"). Controlled via checked/onChange.
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      } ${checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Accessible modal dialog: portalled, role="dialog" + aria-modal, labelled by its
// title, focus-trapped (Tab cycles inside), Esc to close, restores focus to the
// trigger on close, and locks body scroll. Mount it conditionally — it renders
// whenever present. Keep the action buttons inside `children`.
const MODAL_SIZE = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' } as const;
export function Modal({
  onClose,
  title,
  children,
  size = 'md',
  panelClassName = '',
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: keyof typeof MODAL_SIZE;
  panelClassName?: string;
  closeOnBackdrop?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the mount effect (which would
  // steal focus back to the first field on every parent render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    (focusable()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const f = focusable();
        if (f.length === 0) {
          e.preventDefault();
          panel?.focus();
          return;
        }
        const idx = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && idx <= 0) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && idx === f.length - 1) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      prevFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={closeOnBackdrop ? () => onCloseRef.current() : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`max-h-[90vh] w-full ${MODAL_SIZE[size]} overflow-y-auto rounded-xl bg-white p-6 shadow-xl outline-none dark:bg-slate-900 ${panelClassName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-100">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
