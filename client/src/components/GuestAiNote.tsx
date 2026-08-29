import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

// A guest works in a personal SANDBOX tenant that can never opt into AI (no governance surface), so
// an AI button there would only ever 403 with a misleading "not enabled for this workspace". Instead
// we hide the button and show this honest one-liner in its place. Keep it small and non-blocking —
// the sandbox is for exploring, not a broken feature.
export function useIsGuest(): boolean {
  const { user } = useAuth();
  return user?.role === 'GUEST';
}

export default function GuestAiNote({ className = '' }: { className?: string }) {
  const { lang } = useLang();
  const id = lang === 'id';
  return (
    <p className={`inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 ${className}`}>
      <span aria-hidden>✨</span>
      {id
        ? 'Fitur AI tersedia di workspace penuh, bukan sandbox tamu.'
        : 'AI features are available in a full workspace, not the guest sandbox.'}
    </p>
  );
}
