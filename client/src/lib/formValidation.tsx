import type { ReactNode } from 'react';
import type { InputState } from '../components/ui';

// Shared field-validation helpers. These mirror the server-side rules so a field only
// turns green when its value would actually be accepted. Used by every auth/admin form
// (Login, User Management, Resource Pool, Change password) for consistent feedback.

export const isNameValid = (v: string) => v.trim().length >= 2;
export const isEmailValid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// Strong-password rule (matches server `strongPassword`): ≥10 chars, a letter and a number.
export const pwHasLen = (v: string) => v.length >= 10;
export const pwHasMix = (v: string) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v);
export const isPasswordValid = (v: string) => pwHasLen(v) && pwHasMix(v);

/** undefined (neutral) until touched, then green/red — feeds <Input state>. */
export const fieldState = (touched: string | boolean, ok: boolean): InputState | undefined =>
  (!touched ? undefined : ok ? 'valid' : 'invalid');

/** One live requirement line: green ✓ when met, muted • while pending. */
export function Rule({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`flex items-center gap-1 text-xs ${ok ? 'text-green-600' : 'text-slate-400 dark:text-slate-500'}`}>
      <span className="w-3 text-center">{ok ? '✓' : '•'}</span>
      {children}
    </span>
  );
}
