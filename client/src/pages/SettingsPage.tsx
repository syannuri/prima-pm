import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button, Card, Field, Input, SectionTitle, Toggle } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { useLang, type Lang } from '../context/LanguageContext';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { fieldState, isPasswordValid, pwHasLen, pwHasMix, Rule } from '../lib/formValidation';

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Settings</h1>
        {user && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Signed in as {user.name} · {user.email}
          </p>
        )}
      </div>
      <AppearanceCard />
      <SecurityCard />
    </div>
  );
}

const LANGS: { value: Lang; label: string }[] = [
  { value: 'id', label: 'Indonesia' },
  { value: 'en', label: 'English' },
];

function AppearanceCard() {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const dark = theme === 'dark';
  return (
    <Card className="space-y-3">
      <SectionTitle sub="Choose how Prismatix looks and greets you on this device.">Appearance &amp; language</SectionTitle>
      <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
        <div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Dark mode</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {dark ? 'On — easier on the eyes in low light.' : 'Off — using the light theme.'}
          </div>
        </div>
        <Toggle checked={dark} onChange={() => toggle()} label="Toggle dark mode" />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
        <div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Language</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Greeting &amp; dates. Auto-detected from your browser.</div>
        </div>
        <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-700/60">
          {LANGS.map((l) => (
            <button
              key={l.value}
              onClick={() => setLang(l.value)}
              aria-pressed={lang === l.value}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                lang === l.value
                  ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SecurityCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setErr(''); };

  const submit = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => { reset(); toast.success('Password updated. Use it the next time you sign in.'); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not change password'),
  });

  const nextOk = isPasswordValid(next);
  const confirmOk = confirm.length > 0 && confirm === next;
  const canSubmit = current.length > 0 && nextOk && confirmOk && !submit.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next !== confirm) { setErr('New password and confirmation do not match'); return; }
    submit.mutate();
  };

  return (
    <Card>
      <SectionTitle sub="Use a unique password of 10+ characters with at least one letter and one number.">
        Change password
      </SectionTitle>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required state={current ? 'valid' : undefined} />
        </Field>
        <Field label="New password">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required state={fieldState(next, nextOk)} />
          {!!next && (
            <span className="mt-1 flex flex-col gap-0.5">
              <Rule ok={pwHasLen(next)}>At least 10 characters</Rule>
              <Rule ok={pwHasMix(next)}>A letter and a number</Rule>
            </span>
          )}
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required state={fieldState(confirm, confirmOk)} />
          {!!confirm && !confirmOk && <span className="mt-1 block text-xs text-red-500">Does not match the new password</span>}
        </Field>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={!canSubmit}>
            {submit.isPending ? 'Saving…' : 'Update password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
